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

  const { result_id, action, notes } = await req.json();
  if (!result_id || !action) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

  const admin = getAdminClient();

  // Update tracking_result
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

  // Sync ke alumni_profiles juga
  const { data: result } = await admin.from('tracking_results').select('alumni_id').eq('id', result_id).single();
  if (result?.alumni_id) {
    await admin.from('alumni_profiles')
      .update({ tracking_status: newStatus })
      .eq('id', result.alumni_id);
  }

  return NextResponse.json({ success: true, new_status: newStatus });
}