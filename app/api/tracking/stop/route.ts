import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { job_id } = await req.json().catch(() => ({}));
  const admin = getAdminClient();

  // Update semua job yang running jadi cancelled
  // (atau job spesifik kalau job_id dikirim)
  const query = admin
    .from('tracking_jobs')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
      error_message: 'Dihentikan manual oleh admin',
    });

  if (job_id) {
    query.eq('id', job_id);
  } else {
    query.eq('status', 'running');
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  console.log(`[TrackingJob] Dihentikan manual oleh ${user.id}`);
  return NextResponse.json({ success: true });
}