import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';

export async function GET(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const alumni_id = req.nextUrl.searchParams.get('alumni_id');
  const status    = req.nextUrl.searchParams.get('status');
  const job_id    = req.nextUrl.searchParams.get('job_id'); // filter by job

  let query = supabase
    .from('tracking_results')
    .select('*, tracking_evidence(*), alumni_profiles(full_name, study_program, graduation_year, nim, linkedin_url, instagram_url, facebook_url, tiktok_url, email, phone_number, current_company, work_address, current_position, employment_sector, company_social_media)')
    .order('confidence_score', { ascending: false });

  if (job_id) query = query.eq('job_id', job_id);

  if (alumni_id) {
    query = query.eq('alumni_id', alumni_id);
  } else {
    // Admin: check role
    const { data: userData } = await supabase
      .from('users').select('role').eq('id', user.id).single();
    if (userData?.role !== 'admin') {
      // Non-admin can only see own
      const { data: profile } = await supabase
        .from('alumni_profiles').select('id').eq('user_id', user.id).single();
      if (!profile) return NextResponse.json([]);
      query = query.eq('alumni_id', profile.id);
    }
  }

  if (status) query = query.eq('match_status', status);

  // Support pagination
  const page     = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(req.nextUrl.searchParams.get('pageSize') ?? '1000', 10);
  const from     = (page - 1) * pageSize;
  const to       = from + pageSize - 1;

  // Get total count
  // Hitung total dengan query terpisah (tanpa join berat)
  const countQuery = supabase
    .from('tracking_results')
    .select('*', { count: 'exact', head: true });

  // Apply filter yang sama
  if (job_id) countQuery.eq('job_id', job_id);
  if (alumni_id) countQuery.eq('alumni_id', alumni_id);
  if (status) countQuery.eq('match_status', status);

  const { count } = await countQuery;

  // Lanjut fetch data seperti biasa
    const { data, error } = await query.range(from, to);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data: data || [], total: count ?? 0, page, pageSize });
}