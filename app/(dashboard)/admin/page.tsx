import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import Header from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Users, CheckCircle, AlertTriangle, Activity, TrendingUp, Search, FileText } from 'lucide-react';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export default async function AdminDashboardPage() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = getAdminClient();

  // Semua stats dari alumni_profiles (single source of truth)
  const [
    { count: totalAlumni },
    { count: tracked },
    { count: identified },
    { count: needsReview },
    { count: notFound },
    { data: lastJob },
  ] = await Promise.all([
    admin.from('alumni_profiles').select('*', { count: 'exact', head: true }),
    admin.from('alumni_profiles').select('*', { count: 'exact', head: true }).not('last_tracked_at', 'is', null),
    admin.from('alumni_profiles').select('*', { count: 'exact', head: true }).eq('tracking_status', 'identified'),
    admin.from('alumni_profiles').select('*', { count: 'exact', head: true }).eq('tracking_status', 'needs_review'),
    admin.from('alumni_profiles').select('*', { count: 'exact', head: true }).eq('tracking_status', 'not_found'),
    admin.from('tracking_jobs').select('status,identified,needs_review,not_found,processed,total_alumni,created_at').order('created_at', { ascending: false }).limit(1).single(),
  ]);

  // Distribusi program studi — fetch dengan pagination biar dapat semua prodi
  let allPrograms: string[] = [];
  let pageFrom = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: batch } = await admin
      .from('alumni_profiles')
      .select('study_program')
      .not('study_program', 'is', null)
      .range(pageFrom, pageFrom + PAGE_SIZE - 1);
    if (!batch || batch.length === 0) break;
    allPrograms = allPrograms.concat(batch.map((r: any) => r.study_program).filter(Boolean));
    if (batch.length < PAGE_SIZE) break;
    pageFrom += PAGE_SIZE;
  }

  // Hitung frekuensi per prodi
  const programCount: Record<string, number> = {};
  for (const p of allPrograms) {
    const key = p.trim();
    if (key) programCount[key] = (programCount[key] ?? 0) + 1;
  }

  const topPrograms = Object.entries(programCount)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  const total           = totalAlumni ?? 0;
  const trackedCount    = tracked ?? 0;
  const identifiedCount = identified ?? 0;
  const needsReviewCount = needsReview ?? 0;
  const notFoundCount   = notFound ?? 0;
  const coveragePct     = total > 0 ? Math.round((trackedCount / total) * 100) : 0;

  return (
    <>
      <Header title="Admin Dashboard" userName="Administrator" />
      <div className="p-6 space-y-6">

        {/* Header stats */}
        <div>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Ringkasan Data Alumni</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{total.toLocaleString('id-ID')}</p>
                <p className="text-xs text-gray-500">Total Alumni</p>
              </div>
            </Card>
            <Card className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Activity className="w-6 h-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{trackedCount.toLocaleString('id-ID')}</p>
                <p className="text-xs text-gray-500">Sudah Dilacak</p>
                <p className="text-xs text-indigo-500 font-medium">{coveragePct}% coverage</p>
              </div>
            </Card>
            <Card className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-700">{identifiedCount.toLocaleString('id-ID')}</p>
                <p className="text-xs text-gray-500">Teridentifikasi</p>
                <p className="text-xs text-green-500 font-medium">confidence ≥ 70%</p>
              </div>
            </Card>
            <Card className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-yellow-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-6 h-6 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-700">{needsReviewCount.toLocaleString('id-ID')}</p>
                <p className="text-xs text-gray-500">Perlu Validasi</p>
                <p className="text-xs text-yellow-500 font-medium">confidence 30–69%</p>
              </div>
            </Card>
          </div>
        </div>

        {/* Progress bar */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500" /> Progress Pelacakan
            </h3>
            <a href="/admin/tracking" className="text-xs text-blue-600 hover:underline">Lihat detail →</a>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Teridentifikasi', count: identifiedCount,  color: 'bg-green-500',  textColor: 'text-green-700' },
              { label: 'Perlu Validasi',    count: needsReviewCount, color: 'bg-yellow-400', textColor: 'text-yellow-700' },
              { label: 'Tidak Ditemukan',   count: notFoundCount,    color: 'bg-gray-300',   textColor: 'text-gray-500'  },
            ].map(({ label, count, color, textColor }) => {
              // Bagi dengan trackedCount agar bar terlihat (bukan total 138k)
              const pct = trackedCount > 0 ? Math.round((count / trackedCount) * 100) : 0;
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 font-medium">{label}</span>
                    <span className={`font-semibold ${textColor}`}>{count.toLocaleString('id-ID')} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {lastJob && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
              <span>Job terakhir:
                <span className={`ml-1 font-semibold ${lastJob.status === 'completed' ? 'text-green-600' : lastJob.status === 'running' ? 'text-blue-600' : 'text-red-600'}`}>
                  {lastJob.status}
                </span>
              </span>
              <span>{lastJob.processed}/{lastJob.total_alumni} diproses · {lastJob.identified} teridentifikasi</span>
            </div>
          )}
        </Card>

        {/* Chart distribusi prodi */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">Distribusi Program Studi</h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{topPrograms.length} prodi</span>
            </div>
            {topPrograms.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Belum ada data program studi</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {topPrograms.map(({ name, count }, idx) => {
                  const max = topPrograms[0]?.count ?? 1;
                  const pct = Math.round((count / max) * 100);
                  return (
                    <div key={name} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-5 flex-shrink-0">{idx + 1}</span>
                      <span className="text-xs text-gray-600 w-44 truncate flex-shrink-0">{name}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-medium text-gray-700 w-14 text-right">{count.toLocaleString('id-ID')}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="font-semibold text-gray-800 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              {[
                { href: '/admin/alumni',          icon: <Users className="w-4 h-4" />,    label: 'Kelola Alumni',    desc: 'Lihat & cari data alumni', color: 'text-blue-600 bg-blue-50' },
                { href: '/admin/tracking',        icon: <Activity className="w-4 h-4" />, label: 'Tracking Monitor', desc: 'Jalankan & pantau tracking', color: 'text-indigo-600 bg-indigo-50' },
                { href: '/admin/search-profiles', icon: <Search className="w-4 h-4" />,   label: 'Search Profiles',  desc: 'Kelola profil pencarian', color: 'text-purple-600 bg-purple-50' },
                { href: '/admin/reports',         icon: <FileText className="w-4 h-4" />, label: 'Export Laporan',   desc: 'Export CSV untuk akreditasi', color: 'text-green-600 bg-green-50' },
              ].map(link => (
                <a key={link.href} href={link.href} className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition group">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${link.color}`}>{link.icon}</div>
                  <div>
                    <p className="text-sm font-medium text-gray-800 group-hover:text-blue-600 transition">{link.label}</p>
                    <p className="text-xs text-gray-400">{link.desc}</p>
                  </div>
                </a>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}