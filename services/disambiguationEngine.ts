import { AlumniProfile, SearchProfile } from '@/types';
import { TrackingEvidence, ConfidenceBreakdown, TrackingStatus } from '@/types/tracking';
export interface ScoredCandidate {
  evidence: TrackingEvidence;
  breakdown: ConfidenceBreakdown;
  classification: 'strong' | 'needs_review' | 'no_match';
}

/**
 * DISAMBIGUASI ENGINE
 *
 * Confidence score 0.0–1.0 dengan breakdown:
 *  - data_completeness : 0–0.50  Jumlah field data yang terisi (8 field kriteria)
 *  - name_match        : 0–0.25  Kecocokan nama (exact/variasi/inisial)
 *  - timeline_match    : 0–0.15  Tahun aktivitas vs tahun lulus
 *  - field_match       : 0–0.10  Bidang/topik vs prodi
 *
 * Status:
 *  - identified   : ≥ 0.70 (data valid, confidence tinggi)
 *  - needs_review : ≥ 0.30 (butuh validasi manual)
 *  - not_found    : < 0.30
 */
export function scoreCandidate(
  evidence: TrackingEvidence,
  alumni: AlumniProfile,
  profile: SearchProfile,
  crossValidationBonus: number = 0
): ScoredCandidate {
  const raw = (evidence as any).raw_data ?? {};

  // Hitung jumlah field yang terisi dari 8 kriteria
  const fields = [
    raw.detected_linkedin || raw.detected_instagram || raw.detected_facebook || raw.detected_tiktok, // poin 1 (medsos)
    raw.detected_email,           // poin 2
    raw.detected_phone,           // poin 3
    raw.detected_company,         // poin 4
    raw.detected_work_address,    // poin 5
    raw.detected_position,        // poin 6
    raw.detected_employment_type, // poin 7
    raw.detected_company_social,  // poin 8
  ];
  const filledCount = fields.filter(Boolean).length;

  // data_completeness: tiap field = 0.0625 (0.5 / 8 field)
  const dataCompleteness = Math.min(filledCount * 0.0625, 0.50);

  const breakdown: ConfidenceBreakdown = {
    name_match:        scoreNameMatch(evidence, profile),
    affiliation_match: dataCompleteness, // reuse field for data completeness
    timeline_match:    scoreTimelineMatch(evidence, alumni),
    field_match:       scoreFieldMatch(evidence, alumni),
    cross_validation:  Math.min(crossValidationBonus, 0.10),
    total:             0,
  };

  breakdown.total = Math.min(
    1.0,
    breakdown.name_match +
    breakdown.affiliation_match +
    breakdown.timeline_match +
    breakdown.field_match +
    breakdown.cross_validation
  );

  // Status thresholds
  let classification: ScoredCandidate['classification'];
  if (breakdown.total >= 0.70) {
    classification = 'strong';
  } else if (breakdown.total >= 0.30 && filledCount >= 1) {
    // needs_review: butuh validasi manual
    classification = 'needs_review';
  } else {
    classification = 'no_match';
  }

  return { evidence, breakdown, classification };
}

// ── Scoring helpers ────────────────────────────────────────────────────────

function scoreNameMatch(evidence: TrackingEvidence, profile: SearchProfile): number {
  const foundName = normalize(evidence.found_name ?? '');
  if (!foundName) return 0;

  for (const variant of profile.name_variants) {
    const v = normalize(variant);

    // Exact match
    if (foundName === v) return 0.25;

    // Contains full variant
    if (foundName.includes(v) || v.includes(foundName)) return 0.18;

    // Inisial match — "M. Rizky" ~ "Muhammad Rizky"
    if (initialsMatch(foundName, v)) return 0.12;

    // Token overlap — minimal 2 kata yang sama
    const tokenScore = tokenOverlap(foundName, v);
    if (tokenScore >= 0.6) return 0.10;
    if (tokenScore >= 0.4) return 0.06;
  }

  return 0;
}

function scoreTimelineMatch(evidence: TrackingEvidence, alumni: AlumniProfile): number {
  const activityYear = evidence.activity_year;
  if (!activityYear) return 0.08; // netral jika tidak ada data tahun

  const gradYear = alumni.graduation_year;

  if (activityYear >= gradYear) {
    const gap = activityYear - gradYear;
    if (gap <= 10) return 0.15;
    if (gap <= 20) return 0.10;
    return 0.05;
  }

  const preGap = gradYear - activityYear;
  if (preGap <= 2) return 0.08;
  if (preGap <= 4) return 0.04;

  return 0;
}

function scoreFieldMatch(evidence: TrackingEvidence, alumni: AlumniProfile): number {
  const foundField = normalize(evidence.found_field ?? evidence.found_role ?? '');
  const program    = normalize(alumni.study_program);

  if (!foundField) return 0;

  const fieldMap: Record<string, string[]> = {
    'teknik informatika':    ['software','developer','programmer','it','tech','engineer','data','cloud','devops','coding'],
    'sistem informasi':      ['system','analyst','bisnis','erp','it','informasi','konsultan'],
    'manajemen':             ['manager','marketing','hr','bisnis','konsultan','finance','operasional'],
    'akuntansi':             ['akuntan','finance','audit','tax','pajak','keuangan'],
    'hukum':                 ['hukum','lawyer','pengacara','notaris','legal','advokat'],
    'kedokteran':            ['dokter','medis','klinik','rumah sakit','kesehatan','medical'],
    'psikologi':             ['psikolog','konseling','hr','sdm','mental','klinis'],
    'ilmu komunikasi':       ['media','jurnalis','komunikasi','pr','marketing','konten','broadcast'],
    'agribisnis':            ['pertanian','agri','pangan','perkebunan','peternakan','kebun'],
    'teknik sipil':          ['sipil','konstruksi','bangunan','infrastruktur','proyek'],
    'teknik mesin':          ['mesin','manufaktur','industri','otomotif','produksi'],
    'farmasi':               ['farmasi','apoteker','obat','klinik','apotek'],
    'keperawatan':           ['perawat','nurse','keperawatan','rs','rumah sakit'],
  };

  const keywords = fieldMap[program] ?? [];
  if (keywords.some(k => foundField.includes(k))) return 0.10;
  if (keywords.some(k => foundField.includes(k.substring(0, 4)))) return 0.05;

  return 0;
}

// ── String utilities ───────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function initialsMatch(a: string, b: string): boolean {
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);
  if (tokensA.length < 2 || tokensB.length < 2) return false;

  const initialsOfB = tokensB.map(t => t[0]).join('');
  const initialsOfA = tokensA.map(t => t[0]).join('');

  const lastA = tokensA[tokensA.length - 1];
  const lastB = tokensB[tokensB.length - 1];
  if (!lastB.startsWith(lastA) && !lastA.startsWith(lastB)) return false;

  return initialsOfB.startsWith(initialsOfA) || initialsOfA.startsWith(initialsOfB);
}

function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(a.split(' ').filter(t => t.length > 2));
  const tokB = new Set(b.split(' ').filter(t => t.length > 2));
  if (tokA.size === 0 || tokB.size === 0) return 0;

  let common = 0;
  tokA.forEach(t => { if (tokB.has(t)) common++; });

  return common / Math.max(tokA.size, tokB.size);
}

// ── Aggregate multiple candidates ────────────────────────────────────────

export function aggregateCandidates(
  evidences: TrackingEvidence[],
  alumni: AlumniProfile,
  profile: SearchProfile
): {
  bestScore: number;
  trackingStatus: TrackingStatus;
  supportingSources: string[];
  conflictingSources: string[];
  topCandidates: ScoredCandidate[];
} {
  if (evidences.length === 0) {
    return {
      bestScore: 0,
      trackingStatus: 'not_found',
      supportingSources: [],
      conflictingSources: [],
      topCandidates: [],
    };
  }

  // Score semua kandidat
  const scored = evidences
    .map(e => scoreCandidate(e, alumni, profile, 0))
    .filter(c => c.classification !== 'no_match')
    .sort((a, b) => b.breakdown.total - a.breakdown.total);

  if (scored.length === 0) {
    return {
      bestScore: 0,
      trackingStatus: 'not_found',
      supportingSources: [],
      conflictingSources: [],
      topCandidates: [],
    };
  }

  // Cross-validation
  const topCandidate = scored[0];
  const supportingSources: string[] = [];
  const conflictingSources: string[] = [];

  scored.forEach(c => {
    if (c.breakdown.total >= 0.30) {
      const isConsistent = checkConsistency(c.evidence, topCandidate.evidence);
      if (isConsistent) {
        if (!supportingSources.includes(c.evidence.source)) supportingSources.push(c.evidence.source);
      } else {
        if (!conflictingSources.includes(c.evidence.source)) conflictingSources.push(c.evidence.source);
      }
    }
  });

  const crossBonus = Math.min((supportingSources.length - 1) * 0.05, 0.10);
  const finalTop = scoreCandidate(topCandidate.evidence, alumni, profile, crossBonus);

  // Hitung jumlah field terisi dari raw_data kandidat terbaik
  const raw = (topCandidate.evidence as any).raw_data ?? {};
  const fields = [
    raw.detected_linkedin || raw.detected_instagram || raw.detected_facebook || raw.detected_tiktok,
    raw.detected_email, raw.detected_phone, raw.detected_company,
    raw.detected_work_address, raw.detected_position, raw.detected_employment_type, raw.detected_company_social,
  ];
  const filledCount = fields.filter(Boolean).length;

  let trackingStatus: TrackingStatus;
  if (finalTop.breakdown.total >= 0.70) {
    trackingStatus = 'identified';
  } else if (finalTop.breakdown.total >= 0.30 && filledCount >= 1) {
    // needs_review: butuh validasi manual
    trackingStatus = 'needs_review';
  } else {
    trackingStatus = 'not_found';
  }

  return {
    bestScore: finalTop.breakdown.total,
    trackingStatus,
    supportingSources,
    conflictingSources,
    topCandidates: scored.slice(0, 5),
  };
}

function checkConsistency(a: TrackingEvidence, b: TrackingEvidence): boolean {
  if (a.found_name && b.found_name) {
    const similarity = tokenOverlap(normalize(a.found_name), normalize(b.found_name));
    if (similarity < 0.3) return false;
  }

  if (a.found_affiliation && b.found_affiliation) {
    const similarity = tokenOverlap(
      normalize(a.found_affiliation),
      normalize(b.found_affiliation)
    );
    if (similarity === 0) return false;
  }

  return true;
}