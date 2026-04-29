'use client';
import Header from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Download, Users, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import { useState } from 'react';

function ExportCard({ icon, title, desc, type }: { icon: any; title: string; desc: string; type: string }) {
  const Icon = icon;
  const [loading, setLoading] = useState(false);
  const handleExport = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports?type=${type}`);
      if (!res.ok) throw new Error('Gagal export');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `silumni_${type}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export berhasil!');
    } catch (err: any) {
      toast.error(err.message || 'Gagal export');
    } finally { setLoading(false); }
  };
  return (
    <Card className="flex items-start gap-4">
      <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-6 h-6 text-blue-600" />
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
      </div>
      <Button onClick={handleExport} loading={loading} size="sm">
        <Download className="w-4 h-4 mr-1.5" /> Export CSV
      </Button>
    </Card>
  );
}

export default function ReportsPage() {
  return (
    <>
      <Header title="Reports & Export" userName="Administrator" />
      <div className="p-6 space-y-6 max-w-3xl">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Export Laporan</h2>
          <p className="text-sm text-gray-500 mt-1">Export data alumni dan hasil tracking ke format CSV untuk keperluan akreditasi.</p>
        </div>

        <div className="space-y-4">
          <ExportCard
            icon={Activity}
            title="Laporan Hasil Tracking"
            desc="Semua alumni beserta field penilaian: LinkedIn, Instagram, Facebook, TikTok, Email, No HP, Tempat Kerja, Alamat Kerja, Posisi, PNS/Swasta/Wirausaha, dan Sosmed Tempat Kerja."
            type="tracking"
          />
          <ExportCard
            icon={Users}
            title="Data Master Alumni"
            desc="Daftar lengkap semua alumni dengan data dasar: nama, NIM, program studi, tahun lulus, dan status tracking."
            type="alumni"
          />
        </div>
      </div>
    </>
  );
}