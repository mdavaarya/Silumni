import { NextRequest, NextResponse } from 'next/server';
import { runTrackingJob } from '@/services/trackingOrchestrator';

/**
 * Cron endpoint — dipanggil oleh Railway Worker atau Vercel Cron
 * Schedule: setiap 30 menit via Railway Worker
 *
 * Keamanan: wajib sertakan header Authorization: Bearer <CRON_SECRET>
 *
 * Payload (opsional, POST body JSON):
 *   graduation_years: number[]  — filter tahun lulus, misal [2018,2019,...,2025]
 */

async function handleCron(req: NextRequest) {
  // Verifikasi CRON_SECRET
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[Cron] Unauthorized attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse graduation_years dari body (POST) atau abaikan (GET)
  let graduationYears: number[] | undefined;
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (Array.isArray(body?.graduation_years) && body.graduation_years.length > 0) {
      graduationYears = body.graduation_years.map(Number).filter((n: number) => !isNaN(n));
      console.log(`[Cron] Filter tahun lulus: ${graduationYears!.join(', ')}`);
    }
  }

  console.log('[Cron] Tracking job triggered by scheduler');

  try {
    const jobId = await runTrackingJob('scheduler', undefined, undefined, graduationYears);
    console.log(`[Cron] Job completed: ${jobId}`);
    return NextResponse.json({ success: true, job_id: jobId });
  } catch (err: any) {
    console.error('[Cron] Job failed:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handleCron(req); }
export async function POST(req: NextRequest) { return handleCron(req); }