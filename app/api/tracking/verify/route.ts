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

// POST — verifikasi approve/reject
export async function POST(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { result_id, result_ids, action, notes, bulk } = await req.json();

  // ── Bulk action ───────────────────────────────────────────────────────
  if (bulk && Array.isArray(result_ids) && result_ids.length > 0) {
    const newStatus = action === 'approve' ? 'identified' : 'not_found';
    const admin = getAdminClient();

    const { error } = await admin
      .from('tracking_results')
      .update({
        tracking_status:     newStatus,
        alumni_confirmation: action === 'approve' ? 'confirmed' : 'rejected',
        confirmed_at:        new Date().toISOString(),
      })
      .in('id', result_ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Sync alumni_profiles juga
    const { data: bulkResults } = await admin
      .from('tracking_results')
      .select('alumni_id')
      .in('id', result_ids);

    if (bulkResults && bulkResults.length > 0) {
      const alumniIds = bulkResults.map((r: any) => r.alumni_id).filter(Boolean);
      if (alumniIds.length > 0) {
        await admin.from('alumni_profiles')
          .update({ tracking_status: newStatus })
          .in('id', alumniIds);
      }
    }

    return NextResponse.json({ success: true, updated: result_ids.length, new_status: newStatus });
  }

  if (!result_id || !action) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const admin = getAdminClient();
  const newStatus = action === 'approve' ? 'identified' : 'not_found';

  const { error } = await admin
    .from('tracking_results')
    .update({
      tracking_status:     newStatus,
      alumni_confirmation: action === 'approve' ? 'confirmed' : 'rejected',
      confirmed_at:        new Date().toISOString(),
    })
    .eq('id', result_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sync status ke alumni_profiles
  const { data: result } = await admin
    .from('tracking_results')
    .select('alumni_id')
    .eq('id', result_id)
    .single();

  if (result?.alumni_id) {
    await admin
      .from('alumni_profiles')
      .update({ tracking_status: newStatus })
      .eq('id', result.alumni_id);
  }

  return NextResponse.json({ success: true, new_status: newStatus });
}

// PATCH — simpan field dari dropdown evidence ke alumni_profiles
export async function PATCH(req: NextRequest) {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { alumni_id, fields } = await req.json();
  if (!alumni_id || !fields) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const admin = getAdminClient();

  // Hanya update field yang tidak kosong
  const updates: Record<string, string> = {};
  const allowedFields = [
    'linkedin_url', 'instagram_url', 'facebook_url', 'tiktok_url',
    'email', 'phone_number', 'current_company', 'work_address',
    'current_position', 'employment_sector', 'company_social_media',
  ];
  for (const key of allowedFields) {
    if (fields[key] !== undefined) updates[key] = fields[key];
  }

  const { error } = await admin
    .from('alumni_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', alumni_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}