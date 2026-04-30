'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/layout/Header';
import { Card, StatCard } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Table from '@/components/ui/Table';
import Modal from '@/components/ui/Modal';
import { TrackingJob, TrackingResult } from '@/types';
import Pagination, { usePagination } from '@/components/ui/Pagination';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import {
  Play, RefreshCw, Clock, CheckCircle, AlertTriangle,
  XCircle, Eye, Users, BarChart3, Zap, Activity,
  ExternalLink, Search, ThumbsUp, ThumbsDown, Linkedin,
  Instagram, Facebook, Globe, Phone, Mail, Briefcase,
  MapPin, Building2, BadgeCheck, ChevronDown
} from 'lucide-react';

type ExtendedResult = TrackingResult & {
  alumni_profiles?: {
    full_name: string;
    study_program: string;
    graduation_year: number;
    nim: string;
    faculty?: string;
    linkedin_url?: string;
    instagram_url?: string;
    facebook_url?: string;
    tiktok_url?: string;
    email?: string;
    phone_number?: string;
    current_company?: string;
    work_address?: string;
    current_position?: string;
    employment_sector?: string;
    company_social_media?: string;
  };
  tracking_evidence?: Array<{
    id: string;
    source: string;
    source_url?: string;
    title?: string;
    snippet?: string;
    found_name?: string;
    found_affiliation?: string;
    found_role?: string;
    found_location?: string;
    activity_year?: number;
    evidence_score?: number;
    raw_data?: any;
  }>;
};

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 70 ? 'bg-green-500' : pct >= 30 ? 'bg-yellow-400' : 'bg-gray-300';
  const textColor = pct >= 70 ? 'text-green-700' : pct >= 30 ? 'text-yellow-700' : 'text-gray-500';
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 bg-gray-200 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-semibold ${textColor}`}>{pct}%</span>
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  identified:   { label: 'Teridentifikasi',        color: 'text-green-700 bg-green-50 border-green-200',   icon: CheckCircle },
  needs_review: { label: 'Perlu Validasi',          color: 'text-yellow-700 bg-yellow-50 border-yellow-200', icon: AlertTriangle },
  not_found:    { label: 'Tidak Ditemukan',         color: 'text-gray-600 bg-gray-50 border-gray-200',     icon: XCircle },
};

const PAGE_SIZE = 15;

export default function AdminTrackingPage() {
  const [jobs,       setJobs]       = useState<TrackingJob[]>([]);
  const [results,    setResults]    = useState<ExtendedResult[]>([]);
  const [totalTracked, setTotalTracked] = useState<number>(0);
  const [selected,   setSelected]   = useState<ExtendedResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [running,    setRunning]    = useState(false);
  const [hasRunningJob, setHasRunningJob] = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState<string>('all');
  const [verifying,  setVerifying]  = useState(false);
  const [stopping,   setStopping]   = useState(false);
  // Multi-select tahun lulus untuk filter tracking
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [showYearPicker, setShowYearPicker] = useState(false);
  // Filter by job
  const [selectedJobId, setSelectedJobId] = useState<string>('all');
  // Bulk action
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  // Auto-identify threshold (default: ≥2 fields found)
  const AUTO_IDENTIFY_THRESHOLD = 999;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadData = useCallback(async (jobId?: string) => {
    try {
      const resultsUrl = jobId && jobId !== 'all'
        ? `/api/tracking/results?job_id=${jobId}`
        : '/api/tracking/results';
      const [jobsRes, resultsRes] = await Promise.all([
        fetch('/api/tracking/jobs').then(r => r.json()),
        fetch(resultsUrl).then(r => r.json()),
      ]);
      setJobs(Array.isArray(jobsRes) ? jobsRes : []);
      // API sekarang return { data, total } — backward compat jika masih array
      const resultsData = Array.isArray(resultsRes) ? resultsRes : (resultsRes?.data ?? []);
      setTotalTracked(resultsRes?.total ?? resultsData.length);
      setResults(resultsData);
      setLoading(false);

      const hasRunning = (Array.isArray(jobsRes) ? jobsRes : []).some((j: TrackingJob) => j.status === 'running');
      console.log("Job running status:", hasRunning);
      setHasRunningJob(hasRunning);
      if (!hasRunning && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } catch (error) {
      console.error("Error loading data:", error);
      setLoading(false);
    }
  }, []);

  // Load graduation years dari DB saat mount
  useEffect(() => {
    fetch('/api/settings/graduation-years')
      .then(r => r.json())
      .then(d => { if (d.years?.length > 0) setSelectedYears(d.years); })
      .catch(() => {});
  }, []);

  useEffect(() => { loadData(selectedJobId); return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, [loadData, selectedJobId]);

  // Auto-save graduation years ke DB
  const saveYearsTimeout = useRef<NodeJS.Timeout | null>(null);
  const saveGraduationYears = useCallback((years: number[]) => {
    if (saveYearsTimeout.current) clearTimeout(saveYearsTimeout.current);
    saveYearsTimeout.current = setTimeout(() => {
      fetch('/api/settings/graduation-years', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ years }),
      }).catch(() => {});
    }, 500);
  }, []);

  const startPolling = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(loadData, 5000);
  }, [loadData]);

  const handleRunJob = async () => {
    console.log("Starting job...");
    setRunning(true);
    try {
      const res = await fetch('/api/tracking/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graduation_years: selectedYears.length > 0 ? selectedYears : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Job dimulai! ID: ${data.job_id?.slice(0, 8)}...`);
      setHasRunningJob(true);
      await loadData(selectedJobId);
      startPolling();
    } catch (err: any) {
      console.error("Error starting job:", err);
      toast.error(err.message || 'Gagal menjalankan job');
    } finally {
      setRunning(false);
    }
  };

  const handleStopJob = async () => {
    setStopping(true);
    try {
      const runningJob = jobs.find(j => j.status === 'running');
      const res = await fetch('/api/tracking/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: runningJob?.id }),
      });
      if (!res.ok) throw new Error('Gagal menghentikan job');
      setHasRunningJob(false);
      toast.success('🛑 Job dihentikan — alumni saat ini selesai dulu lalu berhenti');
      await loadData(selectedJobId);
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    } catch (err: any) {
      toast.error(err.message);
    } finally { setStopping(false); }
  };

  // Verifikasi manual (pakai endpoint /verify yang sudah diperbaiki)
  const handleVerify = async (resultId: string, action: 'approve' | 'reject', notes?: string) => {
    setVerifying(true);
    try {
      const res = await fetch('/api/tracking/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_id: resultId, action, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memverifikasi');
      toast.success(action === 'approve' ? '✓ Alumni berhasil diverifikasi' : '✗ Alumni ditandai tidak ditemukan');
      await loadData();
      setShowDetail(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally { setVerifying(false); }
  };

  // ── Helper: hitung field yang ditemukan dari alumni_profiles ─────────
  const getFoundFields = (r: ExtendedResult): string[] => {
    const p = r.alumni_profiles;
    return [
      p?.linkedin_url       && 'LinkedIn',
      p?.instagram_url      && 'IG',
      p?.facebook_url       && 'Facebook',
      p?.tiktok_url         && 'TikTok',
      p?.email              && 'Email',
      p?.phone_number       && 'HP',
      p?.current_company    && 'Kerja',
      p?.work_address       && 'Alamat',
      p?.current_position   && 'Jabatan',
      p?.employment_sector  && p.employment_sector,
      p?.company_social_media && 'Sosmed Kerja',
    ].filter(Boolean) as string[];
  };

  // ── Auto-identifikasi: ≥2 field → otomatis identified ────────────────
  const getEffectiveStatus = (r: ExtendedResult): string => {
    if (r.tracking_status === 'identified') return 'identified';
    const fields = getFoundFields(r);
    if (fields.length >= AUTO_IDENTIFY_THRESHOLD) return 'identified';
    return r.tracking_status;
  };

  // ── Bulk: toggle checkbox ─────────────────────────────────────────────
  
  const handleBulkStatusChange = async (newStatus: 'identified' | 'not_found') => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    try {
      const res = await fetch('/api/tracking/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result_ids: Array.from(selectedIds),
          action: newStatus === 'identified' ? 'approve' : 'reject',
          bulk: true,
        }),
      });
      if (!res.ok) throw new Error('Gagal update bulk');
      toast.success(`✅ ${selectedIds.size} alumni diupdate → ${newStatus === 'identified' ? 'Teridentifikasi' : 'Tidak Ditemukan'}`);
      setSelectedIds(new Set());
      await loadData(selectedJobId);
    } catch (err: any) {
      toast.error(err.message);
    } finally { setBulkLoading(false); }
  };

  const stats = {
    total:       totalTracked || results.length,
    identified:  results.filter(r => getEffectiveStatus(r) === 'identified').length,
    needsReview: results.filter(r => getEffectiveStatus(r) === 'needs_review').length,
    notFound:    results.filter(r => getEffectiveStatus(r) === 'not_found').length,
  };

  // ── Pagination & filter — harus sebelum resultColumns ────────────────
  const filteredResults = filter === 'all'
    ? results
    : results.filter(r => getEffectiveStatus(r) === filter);
  const { currentPage, totalPages, paginated: paginatedResults, setPage } = usePagination(filteredResults, PAGE_SIZE);

  const handleFilterChange = (f: string) => {
    setFilter(f);
    setSelectedIds(new Set());
    setPage(1);
  };

  const handleJobFilterChange = (jobId: string) => {
    setSelectedJobId(jobId);
    setSelectedIds(new Set());
    setPage(1);
  };

  // ── Checkbox helpers — setelah paginatedResults terdefinisi ──────────
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedResults.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedResults.map(r => r.id)));
    }
  };

  const jobBadge = (status: string) => {
    const map: Record<string, string> = { completed: 'bg-green-100 text-green-700', running: 'bg-blue-100 text-blue-700', failed: 'bg-red-100 text-red-700', pending: 'bg-gray-100 text-gray-600' };
    return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.pending}`}>{status}</span>;
  };

  const resultColumns = [
    {
      key: 'select', label: (
        <input type="checkbox"
          checked={paginatedResults.length > 0 && selectedIds.size === paginatedResults.length}
          onChange={toggleSelectAll}
          className="w-4 h-4 rounded border-gray-300 text-blue-600"
        />
      ),
      render: (r: ExtendedResult) => (
        <input type="checkbox"
          checked={selectedIds.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="w-4 h-4 rounded border-gray-300 text-blue-600"
        />
      ),
    },
    {
      key: 'alumni', label: 'Alumni',
      render: (r: ExtendedResult) => {
        const p = r.alumni_profiles;
        return (
          <div>
            <p className="font-medium text-gray-900 text-sm">{p?.full_name ?? '—'}</p>
            {p && <p className="text-xs text-gray-400">{p.study_program} · {p.graduation_year}</p>}
          </div>
        );
      },
    },
    {
      key: 'tracking_status', label: 'Status',
      render: (r: ExtendedResult) => {
        const effectiveStatus = getEffectiveStatus(r);
        const cfg = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG[r.tracking_status];
        const Icon = cfg?.icon ?? Clock;
        const isAutoIdentified = effectiveStatus === 'identified' && r.tracking_status !== 'identified';
        return (
          <div className="flex flex-col gap-1">
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border w-fit ${cfg?.color ?? 'text-gray-500 bg-gray-50'}`}>
              <Icon className="w-3.5 h-3.5" />
              {cfg?.label ?? effectiveStatus}
            </div>
            {isAutoIdentified && (
              <span className="text-xs text-green-600 font-medium">⚡ auto</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'confidence_score', label: 'Confidence',
      render: (r: ExtendedResult) => <ConfidenceBadge score={r.confidence_score} />,
    },
    {
      key: 'found_fields', label: 'Data Ditemukan',
      render: (r: ExtendedResult) => {
        const fields = getFoundFields(r);
        const BADGE_COLORS: Record<string, string> = {
          'LinkedIn':    'bg-blue-100 text-blue-700',
          'IG':          'bg-pink-100 text-pink-700',
          'Facebook':    'bg-indigo-100 text-indigo-700',
          'TikTok':      'bg-gray-900 text-white',
          'Email':       'bg-purple-100 text-purple-700',
          'HP':          'bg-green-100 text-green-700',
          'Kerja':       'bg-orange-100 text-orange-700',
          'Alamat':      'bg-teal-100 text-teal-700',
          'Jabatan':     'bg-cyan-100 text-cyan-700',
          'PNS':         'bg-red-100 text-red-700',
          'Swasta':      'bg-yellow-100 text-yellow-700',
          'Wirausaha':   'bg-emerald-100 text-emerald-700',
          'Sosmed Kerja':'bg-violet-100 text-violet-700',
        };
        const shown = fields.slice(0, 4);
        const rest  = fields.length - shown.length;
        return fields.length > 0
          ? (
            <div className="flex flex-wrap gap-1">
              {shown.map(f => (
                <span key={f} className={`text-xs px-1.5 py-0.5 rounded font-medium ${BADGE_COLORS[f] ?? 'bg-gray-100 text-gray-600'}`}>{f}</span>
              ))}
              {rest > 0 && <span className="text-xs text-gray-400">+{rest}</span>}
            </div>
          )
          : <span className="text-xs text-gray-300 italic">Belum ada data</span>;
      },
    },
    {
      key: 'actions', label: '',
      render: (r: ExtendedResult) => (
        <Button size="sm" variant="ghost" onClick={() => { setSelected(r); setShowDetail(true); }}>
          <Eye className="w-3.5 h-3.5 mr-1" /> Detail
        </Button>
      ),
    },
  ];

  return (
    <>
      <Header title="Tracking Monitor" userName="Administrator" />
      <div className="p-6 space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Pelacakan Alumni Otomatis</h2>
            <p className="text-sm text-gray-500 mt-0.5">Cron otomatis: setiap hari 02:00 UTC · atau jalankan manual</p>
          </div>
          <div className="flex gap-3 items-center flex-wrap justify-end">
            <Button variant="secondary" onClick={() => loadData(selectedJobId)}><RefreshCw className="w-4 h-4 mr-1.5" /> Refresh</Button>

            {/* Year Picker */}
            <div className="relative">
              <button
                onClick={() => setShowYearPicker(v => !v)}
                disabled={hasRunningJob}
                className="flex items-center gap-2 text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <span className="text-gray-500">📅 Tahun Lulus:</span>
                <span className="font-medium text-gray-800">
                  {selectedYears.length === 0
                    ? 'Semua'
                    : selectedYears.sort((a,b) => a-b).join(', ')}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>

              {showYearPicker && (
                <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-gray-100 p-3 w-64">
                  <p className="text-xs text-gray-400 mb-2 font-medium">Pilih tahun yang akan ditracking:</p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {Array.from({ length: 15 }, (_, i) => new Date().getFullYear() - 1 - i).map(year => (
                      <button
                        key={year}
                        onClick={() => setSelectedYears(prev => {
                          const next = prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year];
                          saveGraduationYears(next);
                          return next;
                        })}
                        className={`text-xs py-1.5 rounded-lg font-medium transition-colors ${
                          selectedYears.includes(year)
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {year}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => { setSelectedYears([]); saveGraduationYears([]); }}
                      className="flex-1 text-xs text-gray-500 hover:text-gray-700 py-1"
                    >
                      Reset (Semua)
                    </button>
                    <button
                      onClick={() => setShowYearPicker(false)}
                      className="flex-1 text-xs bg-blue-600 text-white rounded-lg py-1 hover:bg-blue-700"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              )}
            </div>

            {hasRunningJob && (
              <Button
                onClick={handleStopJob}
                loading={stopping}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                <XCircle className="w-4 h-4 mr-1.5" /> Stop Job
              </Button>
            )}
            <Button
              onClick={handleRunJob}
              loading={running}
              disabled={running || hasRunningJob}
            >
              <Play className="w-4 h-4 mr-1.5" />
              {selectedYears.length > 0 ? `Tracking ${selectedYears.sort((a,b)=>a-b).join(', ')}` : 'Jalankan Sekarang'}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Dilacak"     value={stats.total}       icon={<Users className="w-5 h-5" />} />
          <StatCard label="Teridentifikasi"   value={stats.identified}  icon={<CheckCircle className="w-5 h-5" />}   color="text-green-600" />
          <StatCard label="Perlu Validasi"    value={stats.needsReview} icon={<AlertTriangle className="w-5 h-5" />} color="text-yellow-600" />
          <StatCard label="Tidak Ditemukan"   value={stats.notFound}    icon={<XCircle className="w-5 h-5" />}       color="text-gray-500" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-500" /> Riwayat Job
            </h3>
            {loading ? <p className="text-gray-400 text-sm text-center py-4">Memuat...</p>
              : jobs.length === 0 ? <p className="text-gray-400 text-sm text-center py-4">Belum ada job</p>
              : (
                <div className="space-y-2 overflow-y-auto max-h-64 pr-1">
                  {jobs.map(job => (
                    <div key={job.id} className="p-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center justify-between mb-1">{jobBadge(job.status)}<span className="text-xs text-gray-400">{formatDate(job.created_at)}</span></div>
                      <p className="text-xs text-gray-600">{job.processed}/{job.total_alumni} alumni</p>
                      <div className="flex gap-3 mt-1 text-xs">
                        <span className="text-green-600">{job.identified} teridentifikasi</span>
                        <span className="text-yellow-600">{job.needs_review} validasi</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </Card>

          <Card className="lg:col-span-2">
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-blue-500" /> Distribusi Status
            </h3>
            {results.length === 0
              ? <div className="text-center py-8"><Search className="w-8 h-8 text-gray-200 mx-auto mb-2" /><p className="text-gray-400 text-sm">Belum ada data tracking</p></div>
              : (
                <div className="space-y-4">
                  {[
                    { label: 'Teridentifikasi',  count: stats.identified,  color: 'bg-green-500',  note: 'confidence ≥ 70%' },
                    { label: 'Perlu Validasi',    count: stats.needsReview, color: 'bg-yellow-400', note: 'confidence 30–69%' },
                    { label: 'Tidak Ditemukan',   count: stats.notFound,    color: 'bg-gray-300',   note: 'confidence < 30%' },
                  ].map(({ label, count, color, note }) => {
                    const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-sm mb-1">
                          <div><span className="text-gray-700 font-medium">{label}</span><span className="text-xs text-gray-400 ml-2">— {note}</span></div>
                          <span className="font-semibold text-gray-900">{count} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2.5">
                          <div className={`${color} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </Card>
        </div>

        <Card padding={false}>
          {/* Row 1: Judul + filter job */}
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-gray-800">Hasil Pelacakan</h3>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{filteredResults.length} alumni</span>
              {selectedIds.size > 0 && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full font-medium">{selectedIds.size} dipilih</span>
              )}
            </div>
            {/* Filter by job */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Job:</label>
              <select
                value={selectedJobId}
                onChange={e => handleJobFilterChange(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 max-w-[220px]"
              >
                <option value="all">Semua Job</option>
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.status} — {formatDate(j.created_at)} ({j.processed}/{j.total_alumni})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 2: Status filter + bulk action */}
          <div className="px-6 py-2 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-1 text-xs">
              {[
                { key: 'all',          label: 'Semua' },
                { key: 'identified',   label: '✓ Teridentifikasi' },
                { key: 'needs_review', label: '⚠ Perlu Validasi' },
                { key: 'not_found',    label: '✗ Tidak Ditemukan' },
              ].map(f => (
                <button key={f.key} onClick={() => handleFilterChange(f.key)}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${filter === f.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {f.label}
                </button>
              ))}
            </div>
            {/* Bulk action — muncul kalau ada yang dipilih */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{selectedIds.size} alumni terpilih:</span>
                <button
                  onClick={() => handleBulkStatusChange('identified')}
                  disabled={bulkLoading}
                  className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  ✓ Set Teridentifikasi
                </button>
                <button
                  onClick={() => handleBulkStatusChange('not_found')}
                  disabled={bulkLoading}
                  className="text-xs bg-gray-500 text-white px-3 py-1.5 rounded-lg hover:bg-gray-600 disabled:opacity-50 font-medium"
                >
                  ✗ Set Tidak Ditemukan
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-gray-400 hover:text-gray-600 px-2"
                >
                  Batal
                </button>
              </div>
            )}
          </div>

          <Table columns={resultColumns} data={paginatedResults} keyField="id" loading={loading}
            emptyMessage="Belum ada hasil tracking. Jalankan tracking job terlebih dahulu." />
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} totalItems={filteredResults.length} itemsPerPage={PAGE_SIZE} />
        </Card>
      </div>

      <Modal open={showDetail} onClose={() => setShowDetail(false)} title="Detail Hasil Tracking" size="lg">
        {selected && (
          <TrackingResultDetail
            result={selected}
            onVerify={handleVerify}
            verifying={verifying}
            onDataUpdated={loadData}
          />
        )}
      </Modal>
    </>
  );
}

// ─── Dropdown Field — pilih nilai dari evidence atau ketik manual ──────────────
function EvidenceDropdownField({
  icon, label, value, href, options, onSelect, fieldKey,
}: {
  icon: any; label: string; value?: string | null; href?: string;
  options: string[]; onSelect: (field: string, val: string) => void; fieldKey: string;
}) {
  const Icon = icon;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const hasValue = !!value;

  return (
    <div className="relative py-2.5 border-b border-gray-50">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${hasValue ? 'bg-blue-50' : 'bg-gray-50'}`}>
          <Icon className={`w-4 h-4 ${hasValue ? 'text-blue-600' : 'text-gray-300'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400">{label}</p>
          {hasValue ? (
            href
              ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline flex items-center gap-1 truncate">{value} <ExternalLink className="w-3 h-3 flex-shrink-0" /></a>
              : <p className="text-sm font-medium text-gray-800 truncate">{value}</p>
          ) : (
            <p className="text-sm text-gray-300 italic">Belum ditemukan</p>
          )}
        </div>
        {/* Tombol dropdown pilih dari evidence */}
        {options.length > 0 && (
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors flex-shrink-0"
          >
            <ChevronDown className="w-3 h-3" /> Pilih
          </button>
        )}
        {hasValue && <BadgeCheck className="w-4 h-4 text-green-500 flex-shrink-0" />}
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white rounded-xl shadow-lg border border-gray-100 p-2">
          <p className="text-xs text-gray-400 px-2 pb-2 border-b border-gray-50">Pilih dari hasil temuan:</p>
          <div className="max-h-40 overflow-y-auto space-y-1 mt-1">
            {options.map((opt, i) => (
              <button key={i} onClick={() => { onSelect(fieldKey, opt); setOpen(false); }}
                className="w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-blue-50 text-gray-700 truncate">
                {opt}
              </button>
            ))}
          </div>
          {/* Input manual */}
          <div className="mt-2 pt-2 border-t border-gray-50 flex gap-1">
            <input
              value={custom}
              onChange={e => setCustom(e.target.value)}
              placeholder="Atau ketik manual..."
              className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={() => { if (custom.trim()) { onSelect(fieldKey, custom.trim()); setCustom(''); setOpen(false); } }}
              className="text-xs bg-blue-600 text-white px-2 py-1 rounded-lg hover:bg-blue-700"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function TrackingResultDetail({ result, onVerify, verifying, onDataUpdated }: {
  result: ExtendedResult;
  onVerify: (id: string, action: 'approve' | 'reject', notes?: string) => void;
  verifying: boolean;
  onDataUpdated: () => void;
}) {
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [fields,  setFields]  = useState({
    linkedin_url:      result.alumni_profiles?.linkedin_url      ?? '',
    instagram_url:     result.alumni_profiles?.instagram_url     ?? '',
    facebook_url:      result.alumni_profiles?.facebook_url      ?? '',
    tiktok_url:        result.alumni_profiles?.tiktok_url        ?? '',
    email:             result.alumni_profiles?.email             ?? '',
    phone_number:      result.alumni_profiles?.phone_number      ?? '',
    current_company:   result.alumni_profiles?.current_company   ?? '',
    work_address:      result.alumni_profiles?.work_address      ?? '',
    current_position:  result.alumni_profiles?.current_position  ?? '',
    employment_sector: result.alumni_profiles?.employment_sector ?? '',
    company_social_media: result.alumni_profiles?.company_social_media ?? '',
  });

  const confidence = Math.round(result.confidence_score * 100);
  const p = result.alumni_profiles;
  const cfg = STATUS_CONFIG[result.tracking_status];
  const Icon = cfg?.icon ?? Clock;
  const confColor = confidence >= 75 ? 'text-green-600' : confidence >= 40 ? 'text-yellow-600' : 'text-gray-400';

  // Kumpulkan semua kandidat nilai dari evidence untuk tiap field
  const evidenceOptions: Record<string, string[]> = {
    linkedin_url:      [],
    instagram_url:     [],
    facebook_url:      [],
    tiktok_url:        [],
    email:             [],
    phone_number:      [],
    current_company:   [],
    work_address:      [],
    current_position:  [],
    employment_sector: [],
    company_social_media: [],
  };

  for (const ev of result.tracking_evidence ?? []) {
    const raw = ev.raw_data ?? {};
    if (raw.detected_linkedin)        push(evidenceOptions.linkedin_url,      raw.detected_linkedin);
    if (raw.detected_instagram)       push(evidenceOptions.instagram_url,     raw.detected_instagram);
    if (raw.detected_facebook)        push(evidenceOptions.facebook_url,      raw.detected_facebook);
    if (raw.detected_tiktok)          push(evidenceOptions.tiktok_url,        raw.detected_tiktok);
    if (raw.detected_email)           push(evidenceOptions.email,             raw.detected_email);
    if (raw.detected_phone)           push(evidenceOptions.phone_number,      raw.detected_phone);
    if (raw.detected_company)         push(evidenceOptions.current_company,   raw.detected_company);
    if (raw.detected_work_address)    push(evidenceOptions.work_address,      raw.detected_work_address);
    if (raw.detected_position)        push(evidenceOptions.current_position,  raw.detected_position);
    if (raw.detected_employment_type) push(evidenceOptions.employment_sector, raw.detected_employment_type);
    if (raw.detected_company_social)  push(evidenceOptions.company_social_media, raw.detected_company_social);
    // Dari field found_ juga
    if (ev.source_url?.includes('linkedin')) push(evidenceOptions.linkedin_url, ev.source_url);
    if (ev.source_url?.includes('instagram')) push(evidenceOptions.instagram_url, ev.source_url);
    if (ev.source_url?.includes('facebook'))  push(evidenceOptions.facebook_url, ev.source_url);
    if (ev.source_url?.includes('tiktok'))    push(evidenceOptions.tiktok_url, ev.source_url);
    if (ev.found_affiliation) push(evidenceOptions.current_company, ev.found_affiliation);
    if (ev.found_role)        push(evidenceOptions.current_position, ev.found_role);
    if (ev.found_location)    push(evidenceOptions.work_address, ev.found_location);
  }

  function push(arr: string[], val: string) {
    if (val && !arr.includes(val)) arr.push(val);
  }

  const filledFields = Object.values(fields).filter(Boolean).length;

  const handleSelect = (fieldKey: string, val: string) => {
    setFields(f => ({ ...f, [fieldKey]: val }));
  };

  // Simpan perubahan field ke DB
  const handleSaveFields = async () => {
    if (!p) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tracking/verify', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alumni_id: result.alumni_id, fields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan');
      toast.success('Data alumni berhasil disimpan');
      onDataUpdated();
    } catch (err: any) {
      toast.error(err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {/* Header alumni */}
      <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3">
        <div><p className="text-xs text-gray-400 uppercase tracking-wide">Alumni</p><p className="font-bold text-gray-900 mt-0.5">{p?.full_name ?? '—'}</p></div>
        <div><p className="text-xs text-gray-400 uppercase tracking-wide">Program Studi</p><p className="font-medium text-gray-800 mt-0.5">{p?.study_program ?? '—'}</p></div>
        <div><p className="text-xs text-gray-400 uppercase tracking-wide">NIM</p><p className="font-medium text-gray-800 mt-0.5">{p?.nim ?? '—'}</p></div>
        <div><p className="text-xs text-gray-400 uppercase tracking-wide">Tahun Lulus</p><p className="font-medium text-gray-800 mt-0.5">{p?.graduation_year ?? '—'}</p></div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Status Tracking</p>
          <div className={`flex items-center gap-1.5 mt-0.5 text-xs font-semibold px-2.5 py-1 rounded-full border w-fit ${cfg?.color}`}>
            <Icon className="w-3.5 h-3.5" />{cfg?.label}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Confidence Score</p>
          <p className={`font-bold text-2xl mt-0.5 ${confColor}`}>{confidence}%</p>
        </div>
      </div>

      {/* 11 Field — dengan dropdown evidence */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-gray-800 text-sm">Data Alumni</h4>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${filledFields >= 6 ? 'bg-green-100 text-green-700' : filledFields >= 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
              {filledFields}/11 field terisi
            </span>
            <button
              onClick={handleSaveFields}
              disabled={saving}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Klik tombol <strong>Pilih</strong> di tiap field untuk memilih dari hasil temuan tracking, atau ketik manual.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 bg-white rounded-xl border border-gray-100 px-4 py-1">
          <EvidenceDropdownField icon={Linkedin}   label="1. LinkedIn"              value={fields.linkedin_url}      href={fields.linkedin_url||undefined}      fieldKey="linkedin_url"      options={evidenceOptions.linkedin_url}      onSelect={handleSelect} />
          <EvidenceDropdownField icon={Instagram}  label="2. Instagram"             value={fields.instagram_url}     href={fields.instagram_url||undefined}     fieldKey="instagram_url"     options={evidenceOptions.instagram_url}     onSelect={handleSelect} />
          <EvidenceDropdownField icon={Facebook}   label="3. Facebook"              value={fields.facebook_url}      href={fields.facebook_url||undefined}      fieldKey="facebook_url"      options={evidenceOptions.facebook_url}      onSelect={handleSelect} />
          <EvidenceDropdownField icon={Globe}      label="4. TikTok"                value={fields.tiktok_url}        href={fields.tiktok_url||undefined}        fieldKey="tiktok_url"        options={evidenceOptions.tiktok_url}        onSelect={handleSelect} />
          <EvidenceDropdownField icon={Mail}       label="5. Email"                 value={fields.email}                                                        fieldKey="email"             options={evidenceOptions.email}             onSelect={handleSelect} />
          <EvidenceDropdownField icon={Phone}      label="6. No HP"                 value={fields.phone_number}                                                 fieldKey="phone_number"      options={evidenceOptions.phone_number}      onSelect={handleSelect} />
          <EvidenceDropdownField icon={Building2}  label="7. Tempat Kerja"          value={fields.current_company}                                              fieldKey="current_company"   options={evidenceOptions.current_company}   onSelect={handleSelect} />
          <EvidenceDropdownField icon={MapPin}     label="8. Alamat Kerja"          value={fields.work_address}                                                 fieldKey="work_address"      options={evidenceOptions.work_address}      onSelect={handleSelect} />
          <EvidenceDropdownField icon={Briefcase}  label="9. Posisi"                value={fields.current_position}                                             fieldKey="current_position"  options={evidenceOptions.current_position}  onSelect={handleSelect} />
          <EvidenceDropdownField icon={BadgeCheck} label="10. PNS/Swasta/Wirausaha" value={fields.employment_sector}                                            fieldKey="employment_sector" options={['PNS','Swasta','Wirausaha']}      onSelect={handleSelect} />
          <EvidenceDropdownField icon={Globe}      label="11. Sosmed Tempat Kerja"  value={fields.company_social_media} href={fields.company_social_media||undefined} fieldKey="company_social_media" options={evidenceOptions.company_social_media} onSelect={handleSelect} />
        </div>
      </div>

      {/* Tombol Verifikasi */}
      {(result.tracking_status === 'needs_review' || result.tracking_status === 'not_found') && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-yellow-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Verifikasi Manual
          </p>
          <p className="text-xs text-yellow-700">Isi field di atas dari hasil temuan, lalu klik Setujui jika alumni ditemukan.</p>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Catatan verifikasi (opsional)..."
            className="w-full text-sm border border-yellow-200 rounded-lg p-2.5 bg-white resize-none h-16 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
          <div className="flex gap-3">
            <Button
              onClick={() => onVerify(result.id, 'approve', notes)}
              loading={verifying}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-2"
            >
              <ThumbsUp className="w-4 h-4" /> Setujui — Alumni Ditemukan
            </Button>
            <Button
              variant="secondary"
              onClick={() => onVerify(result.id, 'reject', notes)}
              loading={verifying}
              className="flex-1 border-red-200 text-red-600 hover:bg-red-50 flex items-center justify-center gap-2"
            >
              <ThumbsDown className="w-4 h-4" /> Tolak — Tidak Ditemukan
            </Button>
          </div>
        </div>
      )}

      {/* Status sudah diverifikasi */}
      {result.alumni_confirmation && result.alumni_confirmation !== 'pending' && (
        <div className={`rounded-xl p-3 text-sm flex items-center gap-2 ${result.alumni_confirmation === 'confirmed' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {result.alumni_confirmation === 'confirmed'
            ? <><CheckCircle className="w-4 h-4" /> Sudah diverifikasi: Alumni ditemukan</>
            : <><XCircle className="w-4 h-4" /> Sudah diverifikasi: Tidak ditemukan</>}
        </div>
      )}

      {/* Evidence detail (collapsed) */}
      {result.tracking_evidence && result.tracking_evidence.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">Bukti Pelacakan ({result.tracking_evidence.length})</p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {result.tracking_evidence.map(e => (
              <div key={e.id} className="text-xs bg-gray-50 rounded-xl p-3 border border-gray-100">
                <div className="flex items-center justify-between mb-1">
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{e.source}</span>
                  <span className={`font-medium ${(e.evidence_score ?? 0) >= 0.5 ? 'text-green-600' : 'text-yellow-600'}`}>
                    skor: {Math.round((e.evidence_score ?? 0) * 100)}%
                  </span>
                </div>
                {e.found_name        && <p className="text-gray-600">Nama: <strong>{e.found_name}</strong></p>}
                {e.found_affiliation && <p className="text-gray-600">Afiliasi: {e.found_affiliation}</p>}
                {e.found_role        && <p className="text-gray-600">Posisi: {e.found_role}</p>}
                {e.title             && <p className="text-gray-800 font-medium leading-snug mt-1">{e.title}</p>}
                {e.source_url && (
                  <a href={e.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate mt-1 flex items-center gap-1">
                    <ExternalLink className="w-3 h-3 flex-shrink-0" /> {e.source_url}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}