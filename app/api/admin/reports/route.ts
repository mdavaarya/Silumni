import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { createClient } from '@supabase/supabase-js';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single();
  return data?.role === 'admin' ? user : null;
}

function toCSV(rows: Record<string, any>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.join(',');
  const body = rows.map(row =>
    keys.map(k => {
      const val = row[k] ?? '';
      const str = Array.isArray(val) ? val.join('; ') : typeof val === 'object' ? JSON.stringify(val) : String(val);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  return `${header}\n${body}`;
}

export async function GET(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getAdminClient();
  const type = req.nextUrl.searchParams.get('type') || 'tracking';

  let csv = '';
  let filename = '';

  if (type === 'tracking') {
    // ── Export utama: semua 8 field penilaian ────────────────────────
    // Ambil semua data dengan pagination
    let allRows: any[] = [];
    let from = 0;
    const PAGE = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('alumni_profiles')
        .select(`
          full_name, nim, graduation_year, study_program, fakultas,
          linkedin_url, instagram_url, facebook_url, tiktok_url,
          email, phone_number, current_company, work_address,
          current_position, employment_sector, company_social_media,
          tracking_status, tracking_confidence, last_tracked_at
        `)
        .order('full_name')
        .range(from, from + PAGE - 1);

      if (error) break;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      from += PAGE;
      if (data.length < PAGE) break;
    }

    // Format untuk export — sesuai 8 field penilaian
    const formatted = allRows.map(r => ({
      'Nama Lulusan':           r.full_name ?? '',
      'NIM':                    r.nim ?? '',
      'Tahun Lulus':            r.graduation_year ?? '',
      'Program Studi':          r.study_program ?? '',
      // ── 8 Field Penilaian ──────────────────────────
      '1. LinkedIn':            r.linkedin_url ?? '',
      '2. Instagram':           r.instagram_url ?? '',
      '3. Facebook':            r.facebook_url ?? '',
      '4. TikTok':              r.tiktok_url ?? '',
      '5. Email':               r.email ?? '',
      '6. No HP':               r.phone_number ?? '',
      '7. Tempat Bekerja':      r.current_company ?? '',
      '8. Alamat Bekerja':      r.work_address ?? '',
      '9. Posisi/Jabatan':      r.current_position ?? '',
      '10. PNS/Swasta/Wirausaha': r.employment_sector ?? '',
      '11. Sosmed Tempat Kerja':  r.company_social_media ?? '',
      // ── Tracking metadata ──────────────────────────
      'Status Tracking':        r.tracking_status ?? 'untracked',
      'Confidence Score':       r.tracking_confidence ? `${Math.round(r.tracking_confidence * 100)}%` : '',
      'Terakhir Dilacak':       r.last_tracked_at ? new Date(r.last_tracked_at).toLocaleDateString('id-ID') : '',
    }));

    csv = toCSV(formatted);
    filename = `silumni_tracking_${new Date().toISOString().split('T')[0]}.csv`;

  } else if (type === 'alumni') {
    let allRows: any[] = [];
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('alumni_profiles')
        .select('full_name,nim,graduation_year,study_program,phone_number,employment_sector,linkedin_url,instagram_url,facebook_url,tiktok_url,tracking_status,current_position,current_company')
        .order('full_name')
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      allRows.push(...data);
      from += 1000;
      if (data.length < 1000) break;
    }
    csv = toCSV(allRows);
    filename = `silumni_alumni_${new Date().toISOString().split('T')[0]}.csv`;

  } else if (type === 'milestones') {
    const { data } = await supabase
      .from('career_milestones')
      .select('alumni_profiles(full_name,nim), company_name, position_title, start_date, classification_label, verification_status, work_address, company_social_media');
    const flat = (data || []).map((r: any) => ({
      full_name: r.alumni_profiles?.full_name,
      nim: r.alumni_profiles?.nim,
      company_name: r.company_name,
      position_title: r.position_title,
      start_date: r.start_date,
      classification_label: r.classification_label,
      verification_status: r.verification_status,
      work_address: r.work_address,
      company_social_media: r.company_social_media,
    }));
    csv = toCSV(flat);
    filename = `silumni_milestones_${new Date().toISOString().split('T')[0]}.csv`;
  }

  if (!csv) return NextResponse.json({ error: 'No data' }, { status: 404 });

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
