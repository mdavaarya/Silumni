/**
 * RAILWAY WORKER — Silumni Tracking (Direct Mode)
 *
 * Alur:
 * 1. Saat deploy → worker TIDAK langsung tracking
 * 2. Worker cek Supabase apakah ada job yang pernah jalan (triggered by manual)
 * 3. Kalau belum ada job manual → tunggu, polling tiap 5 menit
 * 4. Setelah admin klik "Jalankan Sekarang" di UI → job pertama tercatat
 * 5. Worker deteksi ada job manual → mulai tracking otomatis dengan interval
 * 6. Filter tahun dibaca dari app_settings di Supabase (bukan env)
 *
 * Start command: npx tsx --tsconfig tsconfig.worker.json worker.ts
 */

import { createClient } from '@supabase/supabase-js';
import { runTrackingJob } from './services/trackingOrchestrator';

// ── Replica guard ─────────────────────────────────────────────────────────────
const replicaIndex = process.env.RAILWAY_REPLICA_INDEX ?? '0';
const replicaId    = process.env.RAILWAY_REPLICA_ID    ?? '0';
if (replicaIndex !== '0') {
  console.log(`[Worker] Replica ${replicaIndex} — hanya replica 0 yang aktif. Exit.`);
  process.exit(0);
}

// ── Config ───────────────────────────────────────────────────────────────────
const INTERVAL_MINUTES = parseInt(process.env.INTERVAL_MINUTES ?? '60', 10);
const INTERVAL_MS      = INTERVAL_MINUTES * 60 * 1000;
const POLL_MS          = 5 * 60 * 1000; // cek tiap 5 menit apakah admin sudah mulai

// ── Supabase client ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

console.log(`[Worker] 🚀 Silumni Tracking Worker (Direct Mode)`);
console.log(`[Worker] 📦 Replica: ${replicaIndex} / ID: ${replicaId}`);
console.log(`[Worker] ⏱  Interval setelah aktif: ${INTERVAL_MINUTES} menit`);
console.log(`[Worker] ⏳ Menunggu admin mulai tracking pertama dari UI...`);

// ── Baca graduation_years dari Supabase ──────────────────────────────────────
async function getGraduationYears(): Promise<number[] | undefined> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'graduation_years')
    .single();

  if (!data?.value || !Array.isArray(data.value) || data.value.length === 0) {
    return undefined;
  }
  return data.value as number[];
}

// ── Cek apakah admin sudah pernah jalankan job manual ────────────────────────
async function hasManualJobStarted(): Promise<boolean> {
  const { data } = await supabase
    .from('tracking_jobs')
    .select('id')
    .eq('triggered_by', 'manual')
    .limit(1);

  return (data?.length ?? 0) > 0;
}

// ── Main tracking trigger ─────────────────────────────────────────────────────
let isRunning = false;

async function triggerJob() {
  if (isRunning) {
    console.log(`[Worker] ⏭  Job sebelumnya masih berjalan, skip.`);
    return;
  }

  isRunning = true;
  const years = await getGraduationYears();
  const yearsLabel = years ? years.join(', ') : 'semua';
  console.log(`\n[Worker] ⚡ Mulai tracking — ${new Date().toISOString()} | tahun: ${yearsLabel}`);

  try {
    const jobId = await runTrackingJob('scheduler', undefined, undefined, years);
    console.log(`[Worker] ✅ Selesai — job_id: ${jobId}`);
  } catch (err: any) {
    console.error(`[Worker] ❌ Gagal:`, err.message);
  } finally {
    isRunning = false;
    const next = new Date(Date.now() + INTERVAL_MS).toISOString();
    console.log(`[Worker] 💤 Job berikutnya: ${next} (${INTERVAL_MINUTES} menit lagi)\n`);
  }
}

// ── Polling — tunggu admin mulai tracking pertama ────────────────────────────
async function waitForFirstManualJob() {
  const started = await hasManualJobStarted();
  if (started) {
    console.log(`[Worker] ✅ Admin sudah pernah mulai tracking — worker aktif!`);
    const years = await getGraduationYears();
    const yearsLabel = years ? years.join(', ') : 'semua';
    console.log(`[Worker] 🎓 Filter tahun dari DB: ${yearsLabel}`);

    // Langsung trigger satu job, lalu set interval
    await triggerJob();
    setInterval(triggerJob, INTERVAL_MS);
  } else {
    console.log(`[Worker] ⏳ Belum ada job manual — cek lagi dalam 5 menit...`);
    setTimeout(waitForFirstManualJob, POLL_MS);
  }
}

// ── Boot — mulai polling ──────────────────────────────────────────────────────
setTimeout(waitForFirstManualJob, 10_000);

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[Worker] 🛑 Shutting down...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('[Worker] 💥 Uncaught exception:', err.message);
});