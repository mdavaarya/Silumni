import { createClient } from '@supabase/supabase-js';
import { AlumniProfile, SearchProfile, TrackingEvidence } from '@/types';
import { generateSearchQueries } from './queryGeneratorService';
import { aggregateCandidates } from './disambiguationEngine';
import { fetchBySource, fetchFromGemini } from './externalFetcher';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function runTrackingForAlumni(
  alumni: AlumniProfile,
  jobId: string
): Promise<{ status: string; confidence: number }> {
  const supabase = getAdminClient();
  console.log(`[Tracking] Processing: ${alumni.full_name}`);

  // ── 1. Ambil atau buat search profile ────────────────────────────────
  let profile: SearchProfile;
  const { data: profileData } = await supabase
    .from('search_profiles')
    .select('*')
    .eq('alumni_id', alumni.id)
    .single();

  if (!profileData) {
    const { data: created } = await supabase
      .from('search_profiles')
      .insert({
        alumni_id: alumni.id,
        name_variants: autoGenerateVariants(alumni.full_name),
        affiliation_keywords: ['Universitas Muhammadiyah Malang', 'UMM', alumni.study_program],
        context_keywords: [alumni.study_program.toLowerCase(), String(alumni.graduation_year), 'malang'],
        is_low_context: false,
        is_opted_out: false,
      })
      .select()
      .single();
    if (!created) return { status: 'not_found', confidence: 0 };
    profile = created as SearchProfile;
  } else {
    profile = profileData as SearchProfile;
  }

  if (profile.is_opted_out) {
    await supabase.from('tracking_results').insert({
      job_id: jobId, alumni_id: alumni.id,
      confidence_score: 0, tracking_status: 'opted_out', is_latest: true,
    });
    return { status: 'opted_out', confidence: 0 };
  }

  const allEvidence: Partial<TrackingEvidence>[] = [];
  const foundSocmed: {
    linkedin?: string; instagram?: string; facebook?: string; tiktok?: string;
    email?: string; phone?: string; employment_type?: string;
    position?: string; company?: string; work_address?: string; company_social?: string;
  } = {};

  // ── 2. Gemini 1.5 Flash + Serper (3 query multi-kriteria) ───────────
  //
  // Grok    → DISABLED: kredit xAI habis
  // PDDikti → DISABLED: butuh auth token Kemdikti (HTTP 401) — verifikasi via Google
  // Gemini  → AKTIF: gemini-2.0-flash-lite via v1beta + Serper/Tavily rotation
  //
  const geminiKeys = [
    process.env.GEMINI_API_KEY,   process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3, process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5, process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7,
  ].filter(Boolean);
  const hasGeminiKey = geminiKeys.length > 0;

  if (hasGeminiKey) {
    try {
      await supabase.from('tracking_queries').insert({
        job_id: jobId,
        alumni_id: alumni.id,
        query_text: `gemini:${alumni.full_name} | ${alumni.study_program} | UMM`,
        source: 'google',
        executed_at: new Date().toISOString(),
      });

      // ── Cek cancel sebelum Gemini (bisa lama karena 429 retry) ──
      const { data: preGeminiCheck } = await supabase
        .from('tracking_jobs').select('status').eq('id', jobId).single();
      if (preGeminiCheck?.status === 'cancelled') {
        console.log(`[Tracking] Job cancelled — skip ${alumni.full_name}`);
        return { status: 'cancelled', confidence: 0 };
      }

      const geminiResults = await fetchFromGemini(
        alumni.full_name,
        alumni.study_program,
        (alumni as any).faculty ?? '',
        alumni.graduation_year
      );

      for (const ev of geminiResults) {
        const raw = ev.raw_data as any;
        if (!raw) continue;
        if (raw.detected_linkedin        && !foundSocmed.linkedin)        foundSocmed.linkedin        = raw.detected_linkedin;
        if (raw.detected_instagram       && !foundSocmed.instagram)       foundSocmed.instagram       = raw.detected_instagram;
        if (raw.detected_facebook        && !foundSocmed.facebook)        foundSocmed.facebook        = raw.detected_facebook;
        if (raw.detected_tiktok          && !foundSocmed.tiktok)          foundSocmed.tiktok          = raw.detected_tiktok;
        if (raw.detected_email           && !foundSocmed.email)           foundSocmed.email           = raw.detected_email;
        if (raw.detected_phone           && !foundSocmed.phone)           foundSocmed.phone           = raw.detected_phone;
        if (raw.detected_employment_type && !foundSocmed.employment_type) foundSocmed.employment_type = raw.detected_employment_type;
        if (raw.detected_position        && !foundSocmed.position)        foundSocmed.position        = raw.detected_position;
        if (raw.detected_company         && !foundSocmed.company)         foundSocmed.company         = raw.detected_company;
        if (raw.detected_work_address    && !foundSocmed.work_address)    foundSocmed.work_address    = raw.detected_work_address;
        if (raw.detected_company_social  && !foundSocmed.company_social)  foundSocmed.company_social  = raw.detected_company_social;
      }

      allEvidence.push(...geminiResults);
      console.log(`[Tracking] Gemini: ${geminiResults.length} results for ${alumni.full_name}`);

      // Jeda 3 detik — dengan 7 key rotation tidak perlu jeda panjang
      await sleep(3000);
    } catch (err: any) {
      console.error(`[Tracking] Gemini error for ${alumni.full_name}:`, err.message);
      await sleep(3000);
    }
  }

  // ── 3. Fallback: Brave/Google search langsung (kalau Gemini tidak ada) ─
  if (!hasGeminiKey || allEvidence.length === 0) {
    const queries = generateSearchQueries(profile, (alumni as any).employment_sector);
    for (const q of queries) {
      try {
        await supabase.from('tracking_queries').insert({
          job_id: jobId, alumni_id: alumni.id,
          query_text: q.query_text, source: q.source,
          executed_at: new Date().toISOString(),
        });
        const results = await fetchBySource(
          q.source, q.query_text,
          profile.name_variants[0],
          profile.affiliation_keywords[0] ?? ''
        );
        for (const ev of results) {
          const raw = ev.raw_data as any;
          if (!raw) continue;
          if (raw.detected_linkedin        && !foundSocmed.linkedin)        foundSocmed.linkedin        = raw.detected_linkedin;
          if (raw.detected_instagram       && !foundSocmed.instagram)       foundSocmed.instagram       = raw.detected_instagram;
          if (raw.detected_facebook        && !foundSocmed.facebook)        foundSocmed.facebook        = raw.detected_facebook;
          if (raw.detected_tiktok          && !foundSocmed.tiktok)          foundSocmed.tiktok          = raw.detected_tiktok;
          if (raw.detected_email           && !foundSocmed.email)           foundSocmed.email           = raw.detected_email;
          if (raw.detected_phone           && !foundSocmed.phone)           foundSocmed.phone           = raw.detected_phone;
          if (raw.detected_employment_type && !foundSocmed.employment_type) foundSocmed.employment_type = raw.detected_employment_type;
          if (raw.detected_position        && !foundSocmed.position)        foundSocmed.position        = raw.detected_position;
          if (raw.detected_company         && !foundSocmed.company)         foundSocmed.company         = raw.detected_company;
          if (raw.detected_work_address    && !foundSocmed.work_address)    foundSocmed.work_address    = raw.detected_work_address;
        }
        allEvidence.push(...results);
        await sleep(500);
      } catch (err: any) {
        console.error(`[Tracking] Error ${q.source}:`, err.message);
      }
    }
  }

  // ── 4. Score & disambiguate ───────────────────────────────────────────
  const { bestScore, trackingStatus, supportingSources, conflictingSources, topCandidates } =
    aggregateCandidates(allEvidence as TrackingEvidence[], alumni, profile);

  console.log(`[Tracking] ${alumni.full_name}: ${trackingStatus} (${Math.round(bestScore * 100)}%)`);

  // ── 5. Simpan tracking result ─────────────────────────────────────────
  const { data: savedResult } = await supabase
    .from('tracking_results')
    .insert({
      job_id:          jobId,
      alumni_id:       alumni.id,
      confidence_score: bestScore,
      tracking_status:  trackingStatus,
      found_position:  foundSocmed.position    ?? topCandidates[0]?.evidence?.found_role         ?? null,
      found_company:   foundSocmed.company     ?? topCandidates[0]?.evidence?.found_affiliation  ?? null,
      found_location:  foundSocmed.work_address ?? topCandidates[0]?.evidence?.found_location    ?? null,
      found_year:      topCandidates[0]?.evidence?.activity_year ?? null,
      supporting_sources:  supportingSources,
      conflicting_sources: conflictingSources,
      alumni_confirmation: trackingStatus === 'identified' ? 'pending' : null,
      notification_sent: false,
      is_latest: true,
    })
    .select()
    .single();

  // ── 6. Simpan evidence ────────────────────────────────────────────────
  if (savedResult && allEvidence.length > 0) {
    for (const ev of allEvidence.slice(0, 5)) {
      await supabase.from('tracking_evidence').insert({
        result_id:         savedResult.id,
        alumni_id:         alumni.id,
        source:            (ev as any).source ?? 'web',
        source_url:        (ev as any).source_url ?? null,
        title:             (ev as any).title ?? null,
        snippet:           (ev as any).snippet ?? null,
        found_name:        (ev as any).found_name ?? null,
        found_affiliation: (ev as any).found_affiliation ?? null,
        found_role:        (ev as any).found_role ?? null,
        found_location:    (ev as any).found_location ?? null,
        activity_year:     (ev as any).activity_year ?? null,
        evidence_score:    (ev as any).evidence_score ?? 0,
        fetched_at:        new Date().toISOString(),
      });
    }
  }

  // ── 7. Update alumni_profiles — AMAN: tidak timpa data existing dengan null ──
  // Hanya update field yang kosong DI DATABASE, tidak overwrite yang sudah ada
  const profileUpdates: Record<string, any> = {
    last_tracked_at:     new Date().toISOString(),
    tracking_status:     trackingStatus,
    tracking_confidence: bestScore,
  };

  // Poin 6: Jabatan — update hanya kalau ada temuan baru DAN database masih kosong
  const newPosition = foundSocmed.position ?? topCandidates[0]?.evidence?.found_role ?? null;
  if (newPosition && !(alumni as any).current_position) profileUpdates.current_position = newPosition;

  // Poin 4: Tempat kerja
  const newCompany = foundSocmed.company ?? topCandidates[0]?.evidence?.found_affiliation ?? null;
  if (newCompany && !(alumni as any).current_company) profileUpdates.current_company = newCompany;

  // Poin 1: Medsos (hanya isi yang kosong)
  if (foundSocmed.linkedin     && !(alumni as any).linkedin_url)         profileUpdates.linkedin_url         = foundSocmed.linkedin;
  if (foundSocmed.instagram    && !(alumni as any).instagram_url)        profileUpdates.instagram_url        = foundSocmed.instagram;
  if (foundSocmed.facebook     && !(alumni as any).facebook_url)         profileUpdates.facebook_url         = foundSocmed.facebook;
  if (foundSocmed.tiktok       && !(alumni as any).tiktok_url)           profileUpdates.tiktok_url           = foundSocmed.tiktok;
  // Poin 2: Email
  if (foundSocmed.email        && !(alumni as any).email)                profileUpdates.email                = foundSocmed.email;
  // Poin 3: HP
  if (foundSocmed.phone        && !(alumni as any).phone_number)         profileUpdates.phone_number         = foundSocmed.phone;
  // Poin 5: Alamat kerja
  if (foundSocmed.work_address && !(alumni as any).work_address)         profileUpdates.work_address         = foundSocmed.work_address;
  // Poin 7: PNS/Swasta/Wirausaha
  if (foundSocmed.employment_type && !(alumni as any).employment_sector) profileUpdates.employment_sector    = foundSocmed.employment_type;
  // Poin 8: Medsos tempat kerja
  if (foundSocmed.company_social && !(alumni as any).company_social_media) profileUpdates.company_social_media = foundSocmed.company_social;

  await supabase.from('alumni_profiles').update(profileUpdates).eq('id', alumni.id);
  return { status: trackingStatus, confidence: bestScore };
}

export async function runTrackingJob(
  triggeredBy: 'scheduler' | 'manual' = 'scheduler',
  triggeredByUser?: string,
  alumniIds?: string[],
  graduationYears?: number[]
): Promise<string> {
  const supabase = getAdminClient();

  const { data: job } = await supabase
    .from('tracking_jobs')
    .insert({
      status: 'running',
      triggered_by: triggeredBy,
      triggered_by_user: triggeredByUser ?? null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (!job) throw new Error('Failed to create tracking job');

  try {
    let query = supabase.from('alumni_profiles').select('*');

    let alumni: AlumniProfile[] = [];

    if (alumniIds && alumniIds.length > 0) {
      // Manual dengan ID spesifik — langsung ambil
      const { data } = await supabase
        .from('alumni_profiles')
        .select('*')
        .in('id', alumniIds)
        .limit(40);
      alumni = (data ?? []) as AlumniProfile[];
    } else {
      // ── Strategi 2-pass agar selalu dapat 20 alumni ──────────────────
      // Pass 1: alumni yang belum pernah ditrack sama sekali (prioritas utama)
      let baseQuery = supabase.from('alumni_profiles').select('*').is('last_tracked_at', null);
      if (graduationYears && graduationYears.length > 0) {
        baseQuery = baseQuery.in('graduation_year', graduationYears);
      }
      const { data: neverTracked } = await baseQuery.limit(40);
      alumni = (neverTracked ?? []) as AlumniProfile[];

      // Pass 2: kalau kurang dari 20, tambah dari yang paling lama ditrack
      if (alumni.length < 40) {
        const remaining = 40 - alumni.length;
        const excludeIds = alumni.map(a => a.id);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        let oldQuery = supabase
          .from('alumni_profiles')
          .select('*')
          .not('last_tracked_at', 'is', null)
          .is('last_tracked_at', sevenDaysAgo)
          .order('last_tracked_at', { ascending: true }); // paling lama duluan
        if (graduationYears && graduationYears.length > 0) {
          oldQuery = oldQuery.in('graduation_year', graduationYears);
        }
        if (excludeIds.length > 0) {
          oldQuery = oldQuery.not('id', 'in', `(${excludeIds.join(',')})`);
        }
        const { data: oldTracked } = await oldQuery.limit(remaining);
        alumni = [...alumni, ...((oldTracked ?? []) as AlumniProfile[])];
      }

      if (graduationYears && graduationYears.length > 0) {
        console.log(`[TrackingJob] Filter tahun lulus: ${graduationYears.join(', ')}`);
      }
    }


    await supabase.from('tracking_jobs').update({ total_alumni: alumni.length }).eq('id', job.id);

    let identified = 0, needsReview = 0, notFound = 0;

    for (let i = 0; i < alumni.length; i++) {
      // ── Cek apakah job sudah di-cancel oleh admin ──────────────────────
      const { data: jobCheck } = await supabase
        .from('tracking_jobs').select('status').eq('id', job.id).single();
      if (jobCheck?.status === 'cancelled') {
        console.log(`[TrackingJob] Job ${job.id} dihentikan manual — berhenti di alumni ke-${i + 1}`);
        break;
      }

      const a = alumni[i];
      try {
        const { status } = await runTrackingForAlumni(a, job.id);
        if (status === 'cancelled') {
          console.log(`[TrackingJob] Alumni ${a.full_name} di-skip karena job cancelled`);
          break;
        }
        if (status === 'identified')        identified++;
        else if (status === 'needs_review') needsReview++;
        else                                notFound++;
      } catch (err: any) {
        console.error(`[TrackingJob] Error ${a.full_name}:`, err.message);
        notFound++;
      } finally {
        await sleep(3000); // 7 key rotation — jeda 3 detik sudah cukup
      }
      await supabase.from('tracking_jobs').update({
        processed: i + 1, identified, needs_review: needsReview, not_found: notFound,
      }).eq('id', job.id);
    }

    // Cek apakah selesai normal atau di-cancel
    const { data: finalJob } = await supabase
      .from('tracking_jobs').select('status').eq('id', job.id).single();
    if (finalJob?.status !== 'cancelled') {
      await supabase.from('tracking_jobs').update({
        status: 'completed', processed: alumni.length,
        identified, needs_review: needsReview, not_found: notFound,
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);
    }

    return job.id;
  } catch (err: any) {
    await supabase.from('tracking_jobs').update({
      status: 'failed', error_message: err.message,
      completed_at: new Date().toISOString(),
    }).eq('id', job.id);
    throw err;
  }
}

export function autoGenerateVariants(fullName: string): string[] {
  const parts    = fullName.trim().split(/\s+/);
  const variants = new Set<string>();
  variants.add(fullName.trim());
  if (parts.length >= 2) {
    const first = parts[0];
    const last  = parts[parts.length - 1];
    variants.add(`${first} ${last}`);
    variants.add(`${first[0]}. ${last}`);
  }
  return Array.from(variants);
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }