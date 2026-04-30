import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabaseServer';

// GET — ambil graduation_years dari DB
export async function GET() {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('app_settings')
      .select('value')
      .eq('key', 'graduation_years')
      .single();

    if (error || !data) return NextResponse.json({ years: [] });
    return NextResponse.json({ years: data.value as number[] });
  } catch {
    return NextResponse.json({ years: [] });
  }
}

// POST — simpan graduation_years ke DB
export async function POST(req: NextRequest) {
  try {
    const { years } = await req.json();
    if (!Array.isArray(years)) {
      return NextResponse.json({ error: 'Invalid years format' }, { status: 400 });
    }
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from('app_settings')
      .upsert({ key: 'graduation_years', value: years, updated_at: new Date().toISOString() });

    if (error) throw error;
    return NextResponse.json({ success: true, years });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}