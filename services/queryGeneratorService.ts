import { SearchProfile, TrackingSource } from '@/types';

export interface GeneratedQuery {
  query_text: string;
  source: TrackingSource;
  priority: number;
}

/**
 * Multi-Query Generator — 3 query terfokus untuk 8 poin kriteria dosen:
 *
 * Query 1 (Karir & LinkedIn)  → Poin 4,5,6,7 (company, alamat, jabatan, employment_type)
 * Query 2 (Medsos)            → Poin 1 (LinkedIn, Instagram, Facebook, TikTok)
 * Query 3 (Kontak & PDDikti)  → Poin 2,3 (email, HP) + verifikasi PDDikti
 *
 * PDDikti tidak punya API publik yang bisa diakses langsung.
 * Verifikasi dilakukan via Google (data PDDikti terindeks di sana).
 */
export function generateSearchQueries(
  profile: SearchProfile,
  employmentSector?: string
): GeneratedQuery[] {
  const { name_variants } = profile;

  const primaryName = name_variants[0] ?? '';
  const shortName   = name_variants[1] ?? primaryName;

  if (!primaryName) return [];

  const isAkademik = employmentSector === 'Akademik' ||
    profile.context_keywords?.some(k =>
      ['dosen', 'peneliti', 'akademik', 'lecturer'].includes(k.toLowerCase())
    );

  const queries: GeneratedQuery[] = [];

  if (isAkademik) {
    queries.push({
      query_text: `"${primaryName}" "Universitas Muhammadiyah Malang" dosen OR peneliti OR lecturer`,
      source: 'google', priority: 1,
    });
    queries.push({
      query_text: `"${primaryName}" UMM Malang linkedin`,
      source: 'linkedin', priority: 2,
    });
    queries.push({
      query_text: `"${primaryName}" UMM instagram OR facebook OR email OR telepon`,
      source: 'google', priority: 3,
    });
  } else {
    // Query 1: Karir & LinkedIn (Poin 4,5,6,7)
    queries.push({
      query_text: `"${primaryName}" UMM Malang kerja OR jabatan OR perusahaan OR linkedin`,
      source: 'google', priority: 1,
    });

    // Query 2: Medsos (Poin 1 — 4 platform)
    queries.push({
      query_text: `"${primaryName}" UMM instagram OR facebook OR tiktok OR linkedin`,
      source: 'google', priority: 2,
    });

    // Query 3: Kontak + verifikasi PDDikti via Google (Poin 2,3)
    queries.push({
      query_text: `"${shortName}" "Universitas Muhammadiyah Malang" email OR telepon OR kontak`,
      source: 'google', priority: 3,
    });
  }

  // Deduplicate
  const seen = new Set<string>();
  return queries
    .sort((a, b) => a.priority - b.priority)
    .filter(q => {
      const key = `${q.source}:${q.query_text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Query verifikasi PDDikti via Google.
 * API PDDikti membutuhkan auth token Kemdikti (HTTP 401) sehingga tidak bisa
 * diakses langsung. Solusi: data PDDikti terindeks Google, jadi kita cari
 * nama + NIM + UMM untuk verifikasi kelulusan.
 */
export function generatePDDiktiVerificationQuery(
  name: string,
  nim?: string,
  studyProgram?: string
): string {
  if (nim) {
    return `"${name}" "${nim}" "Universitas Muhammadiyah Malang" site:pddikti.kemdiktisaintek.go.id OR pddikti`;
  }
  return `"${name}" "Universitas Muhammadiyah Malang" ${studyProgram ?? ''} pddikti lulusan`;
}