import { TrackingEvidence, TrackingSource } from '@/types';

/**
 * EXTERNAL FETCHER
 *
 * Priority Stack per alumni:
 * 1. Gemini standalone (training data, tanpa konteks web) — paling hemat quota
 * 2. Serper enrichment (jika Gemini dapat data tapi kurang lengkap)
 * 3. Tavily enrichment (fallback jika Serper habis)
 * 4. Google CSE (last resort)
 *
 * Key rotation: Gemini 7 key, Serper 5 key, Tavily 5 key
 */

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Cache ──────────────────────────────────────────────────────────────────
const geminiCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function getCacheKey(name: string, studyProgram: string, graduationYear: number, hasContext: boolean): string {
  return `${name}|${studyProgram}|${graduationYear}|${hasContext ? 'web' : 'standalone'}`;
}
function getCachedResult(key: string): any | null {
  const entry = geminiCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) { geminiCache.delete(key); return null; }
  return entry.data;
}
function setCachedResult(key: string, data: any): void {
  geminiCache.set(key, { data, timestamp: Date.now() });
}

// ── Key rotation helpers ───────────────────────────────────────────────────
function getGeminiKeys(): string[] {
  return [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7,
  ].filter(Boolean) as string[];
}

function getSerperKeys(): string[] {
  return [
    process.env.SERPER_API_KEY,
    process.env.SERPER_API_KEY_2,
    process.env.SERPER_API_KEY_3,
    process.env.SERPER_API_KEY_4,
    process.env.SERPER_API_KEY_5,
  ].filter(Boolean) as string[];
}

function getTavilyKeys(): string[] {
  return [
    process.env.TAVILY_API_KEY_1,
    process.env.TAVILY_API_KEY_2,
    process.env.TAVILY_API_KEY_3,
    process.env.TAVILY_API_KEY_4,
    process.env.TAVILY_API_KEY_5,
  ].filter(Boolean) as string[];
}

// Round-robin index (in-memory, reset per deploy — cukup untuk rate limit spreading)
let serperIdx = 0;
let tavilyIdx = 0;
let geminiIdx = 0; // round-robin agar key 1&2 tidak selalu kena 429
let serperExhausted = false; // true jika semua serper key kena 429/quota habis
let tavilyExhausted = false; // true jika semua tavily key kena 429/quota habis

function nextSerperKey(): string | null {
  const keys = getSerperKeys();
  if (keys.length === 0) return null;
  const key = keys[serperIdx % keys.length];
  serperIdx++;
  return key;
}

function nextTavilyKey(): string | null {
  const keys = getTavilyKeys();
  if (keys.length === 0) return null;
  const key = keys[tavilyIdx % keys.length];
  tavilyIdx++;
  return key;
}

// ── Serper search (dengan rotation) ──────────────────────────────────────
async function serperSearch(query: string): Promise<string> {
  if (serperExhausted) return ''; // skip kalau semua key sudah quota habis
  const apiKey = nextSerperKey();
  if (!apiKey) return '';
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'id', hl: 'id', num: 5 }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) {
      console.warn(`[Serper] 429 quota habis — switch ke Tavily untuk seterusnya`);
      serperExhausted = true;
      return '';
    }
    if (!res.ok) { console.warn(`[Serper] HTTP ${res.status}`); return ''; }
    serperExhausted = false; // reset kalau berhasil
    const data = await res.json();
    return (data?.organic ?? []).map((item: any) =>
      `Sumber: ${item.link ?? ''}\nJudul: ${item.title ?? ''}\nKonten: ${item.snippet ?? ''}`
    ).join('\n\n');
  } catch (err: any) {
    console.warn(`[Serper] Error:`, err.message);
    return '';
  }
}

// ── Tavily search (dengan rotation) ──────────────────────────────────────
async function tavilySearch(query: string): Promise<string> {
  if (tavilyExhausted) return ''; // skip kalau semua key sudah quota habis
  const apiKey = nextTavilyKey();
  if (!apiKey) return '';
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429) {
      console.warn(`[Tavily] 429 quota habis — switch ke Google CSE untuk seterusnya`);
      tavilyExhausted = true;
      return '';
    }
    if (!res.ok) { console.warn(`[Tavily] HTTP ${res.status}`); return ''; }
    tavilyExhausted = false; // reset kalau berhasil
    const data = await res.json();
    return (data?.results ?? []).map((item: any) =>
      `Sumber: ${item.url ?? ''}\nJudul: ${item.title ?? ''}\nKonten: ${item.content ?? ''}`
    ).join('\n\n');
  } catch (err: any) {
    console.warn(`[Tavily] Error:`, err.message);
    return '';
  }
}

// ── Google CSE fallback ───────────────────────────────────────────────────
async function googleCSESearch(query: string): Promise<string> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;
  if (!apiKey || !cx) return '';
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return '';
    const data = await res.json();
    return (data?.items ?? []).map((item: any) =>
      `Sumber: ${item.link ?? ''}\nJudul: ${item.title ?? ''}\nKonten: ${item.snippet ?? ''}`
    ).join('\n\n');
  } catch { return ''; }
}

// ── Ambil konteks web (Serper → Tavily → Google CSE) ─────────────────────
async function fetchWebContext(name: string): Promise<string> {
  const queries = [
    `"${name}" UMM Malang kerja OR jabatan OR perusahaan OR linkedin`,
    `"${name}" UMM instagram OR facebook OR tiktok OR email OR telepon`,
  ];

  let context = '';

  for (const q of queries) {
    let ctx = await serperSearch(q);
    if (!ctx) ctx = await tavilySearch(q);
    if (!ctx) ctx = await googleCSESearch(q);
    if (ctx) context += ctx + '\n\n';
    await sleep(3000);
  }

  return context;
}

// ── Gemini extract (key rotation + maxOutputTokens fix) ───────────────────
async function geminiExtract(
  name: string,
  studyProgram: string,
  graduationYear: number,
  context: string
): Promise<any> {
  const cacheKey = getCacheKey(name, studyProgram, graduationYear,  context.length > 50);
  const cached = getCachedResult(cacheKey);
  if (cached) {
    console.log(`[Gemini] Cache hit for ${name}`);
    return cached;
  }

  const keys = getGeminiKeys();
  if (keys.length === 0) return null;

  const hasContext = context.length > 50;

  const prompt = hasContext
    ? `Anda adalah agen ekstraksi data profesional untuk tracking alumni Universitas Muhammadiyah Malang (UMM).

TUGAS: Ekstrak data alumni dari teks berikut ke dalam JSON murni.

Kriteria:
1. Medsos: linkedin, instagram, facebook, tiktok (URL/Username)
2. Email
3. No Hp
4. Tempat bekerja
5. Alamat bekerja
6. Posisi/Jabatan
7. Kategori: PNS (jika instansi pemerintah/Dinas/Kementerian/BUMN/TNI/Polri/ASN), Swasta (perusahaan swasta), atau Wirausaha (Owner/Founder/Pendiri/usaha sendiri)
8. Medsos kantor/tempat bekerja

ATURAN PENTING:
- found_name: isi HANYA jika nama "${name}" atau variasinya muncul secara eksplisit dalam teks. Jika tidak ada, isi null.
- Jika data tidak ada dalam teks, isi dengan null. JANGAN mengarang.
- Kembalikan HANYA JSON murni, tanpa markdown, tanpa teks tambahan.

Teks:
${context.slice(0, 3500)}

Nama Alumni: "${name}" | UMM | Prodi: ${studyProgram} | Lulus: ${graduationYear}

JSON Output:
{"found_name":null,"linkedin_url":null,"instagram_url":null,"facebook_url":null,"tiktok_url":null,"email":null,"phone":null,"company":null,"work_address":null,"position":null,"employment_type":null,"company_social_media":null}`
    : `Anda adalah agen pencarian data alumni. Berdasarkan pengetahuanmu, cari informasi tentang alumni berikut.

Nama: "${name}"
Universitas: Universitas Muhammadiyah Malang (UMM)
Program Studi: ${studyProgram}
Tahun Lulus: ${graduationYear}

ATURAN:
- Isi hanya jika kamu YAKIN data tersebut benar. JANGAN mengarang.
- found_name: isi nama jika kamu mengenal orang ini, null jika tidak.
- Kembalikan HANYA JSON murni, tanpa markdown.

JSON Output:
{"found_name":null,"linkedin_url":null,"instagram_url":null,"facebook_url":null,"tiktok_url":null,"email":null,"phone":null,"company":null,"work_address":null,"position":null,"employment_type":null,"company_social_media":null}`;

  // Coba maksimal 2 putaran: putaran pertama langsung, putaran kedua setelah tunggu 65 detik
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) {
      console.warn(`[Gemini] Semua key 429 — tunggu 80 detik lalu retry untuk ${name}...`);
      await sleep(80000);
    }

  const startIdx = geminiIdx % keys.length;
  for (let offset = 0; offset < keys.length; offset++) {
    const i = (startIdx + offset) % keys.length;
    const apiKey = keys[i];
    const keyInfo = ` [key ${i + 1}/${keys.length}]`;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.0, maxOutputTokens: 2048 },
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const errText = await res.text();
        if (res.status === 429) {
          console.warn(`[Gemini] 429${keyInfo} → pindah key berikutnya...`);
          await sleep(8000);
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      // Ambil JSON terlengkap — cari dari { pertama sampai } terakhir
      const firstBrace = cleaned.indexOf('{');
      const lastBrace  = cleaned.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        console.warn(`[Gemini] Bukan JSON${keyInfo} untuk ${name}:`, content.slice(0, 80));
        return null;
      }
      const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);

      let parsed: any;
      try { parsed = JSON.parse(jsonStr); }
      catch { console.warn(`[Gemini] JSON.parse gagal${keyInfo}`); return null; }

      for (const key of Object.keys(parsed)) {
        if (parsed[key] === '' || parsed[key] === 'null') parsed[key] = null;
      }

      setCachedResult(cacheKey, parsed);
      geminiIdx = i + 1;
      console.log(`[Gemini] OK${keyInfo} for ${name} — context: ${hasContext ? 'web' : 'standalone'}`);
      return parsed;

    } catch (err: any) {
      console.warn(`[Gemini] Error${keyInfo}:`, err.message);
      return null;
    }
  } // end inner key loop

  } // end attempt loop

  console.warn(`[Gemini] Semua key tetap 429 setelah retry — skip ${name}`);
  return null;
}

// ── MAIN: fetchFromGemini ─────────────────────────────────────────────────
export async function fetchFromGemini(
  name: string,
  studyProgram: string,
  faculty: string,
  graduationYear: number
): Promise<Partial<TrackingEvidence>[]> {
  if (getGeminiKeys().length === 0) return [];

  // Step 1: Gemini standalone dulu (hemat quota web search)
  let parsed = await geminiExtract(name, studyProgram, graduationYear, '');

  // Step 2: Jika Gemini standalone tidak dapat data, coba dengan konteks web
  // Cek semua field — termasuk company & position yang sering diisi Gemini standalone
  const standaloneHasData = parsed && Object.values(parsed).some(
    v => v !== null && v !== undefined && v !== ''
  );

  if (!standaloneHasData) {
    console.log(`[Fetcher] Standalone kosong untuk ${name}, ambil konteks web...`);
    const context = await fetchWebContext(name);
    console.log(`[Fetcher] Web context: ${context.length} chars for ${name}`);
    if (context.length > 50) {
      parsed = await geminiExtract(name, studyProgram, graduationYear, context);
    }
  }

  if (!parsed) return [];

  const hasData =
    parsed.linkedin_url || parsed.instagram_url || parsed.facebook_url ||
    parsed.tiktok_url || parsed.email || parsed.phone ||
    parsed.company || parsed.position;
  if (!hasData) return [];

  const filledFields = [
    parsed.linkedin_url, parsed.instagram_url, parsed.facebook_url, parsed.tiktok_url,
    parsed.email, parsed.phone, parsed.company, parsed.work_address,
    parsed.position, parsed.employment_type, parsed.company_social_media,
  ].filter(Boolean).length;

  return [{
    source: 'google' as TrackingSource,
    source_url: '',
    title: `Profil: ${parsed.found_name || name}`,
    snippet: `${parsed.position || ''} ${parsed.company ? 'di ' + parsed.company : ''}`.trim(),
    found_name:        parsed.found_name   || null,
    found_affiliation: parsed.company      || '',
    found_role:        parsed.position     || '',
    found_location:    parsed.work_address || '',
    activity_year:     graduationYear + 1,
    evidence_score:    Math.min(0.30 + filledFields * 0.06, 1.0),
    raw_data: {
      detected_linkedin:        parsed.linkedin_url         || null,
      detected_instagram:       parsed.instagram_url        || null,
      detected_facebook:        parsed.facebook_url         || null,
      detected_tiktok:          parsed.tiktok_url           || null,
      detected_email:           parsed.email                || null,
      detected_phone:           parsed.phone                || null,
      detected_company:         parsed.company              || null,
      detected_work_address:    parsed.work_address         || null,
      detected_position:        parsed.position             || null,
      detected_employment_type: parsed.employment_type      || null,
      detected_company_social:  parsed.company_social_media || null,
      source_urls:              [],
      used_web_context:         standaloneHasData ? false : true,
      gemini_raw:               parsed,
    },
    fetched_at: new Date().toISOString(),
  }];
}

// ── fetchFromGoogle (fallback untuk fetchBySource) ────────────────────────
export async function fetchFromGoogle(
  queryText: string,
  source: TrackingSource = 'google'
): Promise<Partial<TrackingEvidence>[]> {
  let text = await serperSearch(queryText);
  if (!text) text = await tavilySearch(queryText);
  if (!text) text = await googleCSESearch(queryText);
  if (!text) return [];

  return text.split('\n\n').filter(Boolean).map(block => {
    const lines = block.split('\n');
    const link    = lines.find(l => l.startsWith('Sumber:'))?.replace('Sumber: ', '') ?? '';
    const title   = lines.find(l => l.startsWith('Judul:'))?.replace('Judul: ', '') ?? '';
    const snippet = lines.find(l => l.startsWith('Konten:'))?.replace('Konten: ', '') ?? '';
    return buildEvidenceFromResult(link, title, snippet, source);
  });
}

function buildEvidenceFromResult(
  link: string, title: string, snippet: string, source: TrackingSource
): Partial<TrackingEvidence> {
  const combined = `${title} ${snippet}`;
  return {
    source: detectSourceFromUrl(link) ?? source,
    source_url: link, title, snippet,
    found_name: '',
    found_affiliation: extractAffiliationFromText(combined),
    found_role:        extractRoleFromText(combined),
    found_location:    extractLocationFromText(combined),
    activity_year:     extractYearFromText(combined),
    raw_data: {
      detected_linkedin:        isLinkedIn(link)  ? link : null,
      detected_instagram:       isInstagram(link) ? link : null,
      detected_facebook:        isFacebook(link)  ? link : null,
      detected_tiktok:          isTikTok(link)    ? link : null,
      detected_email:           extractEmailFromText(combined),
      detected_phone:           extractPhoneFromText(combined),
      detected_employment_type: detectEmploymentType(combined),
      detected_position:        extractRoleFromText(combined),
      detected_company:         extractAffiliationFromText(combined),
      detected_work_address:    extractLocationFromText(combined),
    },
    fetched_at: new Date().toISOString(),
  };
}

export async function fetchFromScholar(name: string, affiliation: string): Promise<Partial<TrackingEvidence>[]> {
  return fetchFromGoogle(`"${name}" "${affiliation}" penelitian`, 'scholar');
}

export async function fetchFromORCID(name: string, affiliationKeyword: string): Promise<Partial<TrackingEvidence>[]> {
  try {
    const url = `https://pub.orcid.org/v3.0/search?q=${encodeURIComponent(`${name} ${affiliationKeyword}`)}&rows=3`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.['expanded-result'] ?? []).map((r: any) => ({
      source: 'orcid' as TrackingSource,
      source_url: `https://orcid.org/${r['orcid-id']}`,
      title: `ORCID: ${r['given-names'] ?? ''} ${r['family-name'] ?? ''}`.trim(),
      found_name: `${r['given-names'] ?? ''} ${r['family-name'] ?? ''}`.trim(),
      found_affiliation: r['institution-name']?.[0] ?? '',
      found_role: 'Researcher',
      raw_data: r,
      fetched_at: new Date().toISOString(),
    }));
  } catch { return []; }
}

export async function fetchBySource(
  source: TrackingSource,
  queryText: string,
  nameVariant: string,
  affiliationKeyword: string
): Promise<Partial<TrackingEvidence>[]> {
  switch (source) {
    case 'orcid':   return fetchFromORCID(nameVariant, affiliationKeyword);
    case 'scholar': return fetchFromScholar(nameVariant, affiliationKeyword);
    default:        return fetchFromGoogle(queryText, source);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function detectSourceFromUrl(url: string): TrackingSource | null {
  if (isLinkedIn(url))                return 'linkedin';
  if (url.includes('scholar.google')) return 'scholar';
  if (url.includes('orcid.org'))      return 'orcid';
  if (url.includes('researchgate'))   return 'researchgate';
  return null;
}
const isLinkedIn  = (url: string) => url.includes('linkedin.com');
const isInstagram = (url: string) => url.includes('instagram.com');
const isFacebook  = (url: string) => url.includes('facebook.com');
const isTikTok    = (url: string) => url.includes('tiktok.com');

function extractAffiliationFromText(text: string): string {
  const kws = ['universitas','university','institut','pt ','cv ','tbk','pemerintah','dinas','kementerian','rumah sakit','bank'];
  const lower = text.toLowerCase();
  for (const kw of kws) {
    const i = lower.indexOf(kw);
    if (i !== -1) return text.slice(i, i + 80).split(/[,|·\n]/)[0].trim();
  }
  return '';
}
function extractRoleFromText(text: string): string {
  const roles = ['software engineer','data scientist','developer','manager','director','CEO','CTO','dosen','researcher','konsultan','kepala','koordinator','staff','pegawai','guru','dokter','akuntan','wirausaha','PNS','ASN'];
  const lower = text.toLowerCase();
  for (const r of roles) { if (lower.includes(r.toLowerCase())) return r; }
  return '';
}
function extractLocationFromText(text: string): string {
  const cities = ['jakarta','surabaya','bandung','malang','yogyakarta','semarang','medan','makassar','bali','denpasar','solo','bogor','tangerang','bekasi'];
  const lower = text.toLowerCase();
  for (const c of cities) { if (lower.includes(c)) return c.charAt(0).toUpperCase() + c.slice(1); }
  return '';
}
function extractYearFromText(text: string): number | undefined {
  const m = text.match(/\b(20\d{2}|19[89]\d)\b/);
  return m ? parseInt(m[1]) : undefined;
}
function extractEmailFromText(text: string): string | null {
  return text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0] ?? null;
}
function extractPhoneFromText(text: string): string | null {
  return text.match(/(\+62|62|0)[0-9\-\s]{8,14}/)?.[0]?.replace(/\s/g, '') ?? null;
}
function detectEmploymentType(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.match(/\bpns\b|\basin\b|aparatur sipil|pegawai negeri/)) return 'PNS';
  if (lower.match(/wiraswasta|wirausaha|entrepreneur|founder|owner/)) return 'Wirausaha';
  if (lower.match(/pt\s|tbk|swasta|perusahaan|karyawan/))            return 'Swasta';
  return null;
}
