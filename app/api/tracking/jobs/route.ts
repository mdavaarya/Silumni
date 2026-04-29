import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (userData?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Auto-reset job yang stuck 'running' lebih dari 30 menit
  const stuckThreshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await supabase
    .from('tracking_jobs')
    .update({ status: 'failed', error_message: 'Job timeout - auto reset oleh sistem' })
    .eq('status', 'running')
    .lt('created_at', stuckThreshold);

  const { data, error } = await supabase
    .from('tracking_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}