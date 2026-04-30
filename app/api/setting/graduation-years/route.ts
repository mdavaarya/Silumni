import { NextResponse } from 'next/server';
import { createSupabaseServerClient, createSupabaseAdminClient } from '@/lib/supabaseServer';

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (userData?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const admin = createSupabaseAdminClient();

  const [
    { count: identified },
    { count: needsReview },
    { count: notFound },
    { count: total },
  ] = await Promise.all([
    admin.from('tracking_results').select('*', { count: 'exact', head: true }).eq('tracking_status', 'identified').eq('is_latest', true),
    admin.from('tracking_results').select('*', { count: 'exact', head: true }).eq('tracking_status', 'needs_review').eq('is_latest', true),
    admin.from('tracking_results').select('*', { count: 'exact', head: true }).eq('tracking_status', 'not_found').eq('is_latest', true),
    admin.from('tracking_results').select('*', { count: 'exact', head: true }).eq('is_latest', true),
  ]);

  return NextResponse.json({
    identified:  identified  ?? 0,
    needsReview: needsReview ?? 0,
    notFound:    notFound    ?? 0,
    total:       total       ?? 0,
  });
}