# 🎓 Silumni

Sistem pelacakan dan profiling alumni **Universitas Muhammadiyah Malang (UMM)** berbasis web. Silumni memungkinkan admin untuk memantau perkembangan karier alumni secara otomatis melalui pencarian berbasis AI, serta memverifikasi data yang memerlukan validasi manual.

---

## ✨ Fitur Utama

- **Dashboard Admin** — Statistik alumni, distribusi program studi, status pelacakan, dan aktivitas terkini.
- **Manajemen Alumni** — Import data alumni massal via CSV, kelola profil, dan pantau status tracking.
- **Sistem Pelacakan Otomatis (AI Tracking)** — Melacak data karier dan kontak alumni secara otomatis menggunakan Gemini AI + Serper/Tavily web search.
- **Search Profile** — Konfigurasi konteks pencarian per alumni (varian nama, keyword afiliasi, keyword konteks).
- **Validasi Admin** — Data yang tidak dapat dideteksi otomatis masuk antrian validasi manual oleh admin.
- **Laporan (Reports)** — Rekap status tracking seluruh alumni dalam format yang dapat diekspor.
- **Notifikasi** — Kirim notifikasi ke alumni via email, WhatsApp, atau in-app saat data baru ditemukan.
- **Cron Job Otomatis** — Tracking berjalan otomatis setiap hari pukul 02.00 WIB via Vercel Cron.

---

## 🛠️ Tech Stack

| Layer | Teknologi |
|---|---|
| Framework | Next.js 14 (App Router) |
| Bahasa | TypeScript |
| Styling | TailwindCSS 3 |
| Database & Auth | Supabase (PostgreSQL + Row Level Security) |
| AI Ekstraksi | Google Gemini (gemini-flash-latest, key rotation 7 key) |
| Web Search | Serper.dev (5 key) → Tavily (5 key) → Google CSE (fallback) |
| Grafik | Recharts |
| Deployment | Vercel (dengan Cron Jobs) |
| Package Manager | pnpm |

---

## 📁 Struktur Proyek

```
Silumni/
├── app/
│   ├── (auth)/login/          # Halaman login
│   ├── (dashboard)/
│   │   ├── admin/             # Dashboard & manajemen alumni
│   │   │   ├── page.tsx       # Dashboard utama admin
│   │   │   ├── alumni/        # Daftar & import alumni
│   │   │   ├── tracking/      # Monitoring tracking AI
│   │   │   ├── search-profiles/ # Konfigurasi profil pencarian
│   │   │   └── reports/       # Laporan alumni
│   │   └── layout.tsx
│   └── api/
│       ├── admin/             # API manajemen alumni & laporan
│       ├── tracking/          # API tracking (run, stop, hasil, konfirmasi)
│       ├── alumni/            # API profil & milestone alumni
│       ├── cron/tracking/     # Endpoint cron job harian
│       └── setting/           # API pengaturan (tahun lulus, dll.)
│
├── components/
│   ├── charts/                # Komponen grafik (Recharts)
│   ├── forms/                 # Form profil, milestone, sertifikasi
│   ├── layout/                # Header & Sidebar
│   └── ui/                    # Komponen UI dasar (Button, Card, Table, dll.)
│
├── services/
│   ├── externalFetcher.ts     # Integrasi Gemini + Serper + Tavily + Google CSE
│   ├── trackingOrchestrator.ts # Orkestrasi proses tracking per alumni
│   ├── disambiguationEngine.ts # Skoring & disambiguasi kandidat
│   ├── queryGeneratorService.ts # Generator query pencarian
│   ├── searchProfileService.ts  # Manajemen search profile
│   ├── adminService.ts         # Layanan admin
│   ├── alumniService.ts        # Layanan profil alumni
│   └── notificationService.ts  # Layanan notifikasi
│
├── types/
│   ├── index.ts               # Semua tipe data utama (AlumniProfile, TrackingResult, dll.)
│   └── tracking.ts            # Tipe khusus tracking
│
├── lib/
│   ├── supabaseClient.ts      # Client Supabase (browser)
│   ├── supabaseServer.ts      # Client Supabase (server)
│   └── utils.ts               # Utility functions
│
├── supabase/
│   ├── schema.sql             # Definisi tabel & RLS
│   └── seed.sql               # Data awal
│
├── middleware.ts              # Auth & role guard (Next.js middleware)
├── worker.ts                  # Worker tracking (mode CLI)
├── vercel.json                # Konfigurasi Vercel + Cron
└── .env.example               # Template environment variables
```

---

## 🚀 Cara Menjalankan

### Prasyarat

- Node.js >= 18
- pnpm >= 9
- Akun Supabase
- Google Gemini API Key (minimal 1, disarankan 7 untuk rotasi)

### 1. Clone & Install

```bash
git clone <repo-url>
cd Silumni
pnpm install
```

### 2. Konfigurasi Environment

Salin `.env.example` menjadi `.env.local` dan isi sesuai kebutuhan:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Gemini (wajib, bisa sampai 7 key untuk rotasi)
GEMINI_API_KEY=AIza...
GEMINI_API_KEY_2=AIza...
# ...sampai GEMINI_API_KEY_7

# Serper (opsional, 5 key untuk rotasi)
SERPER_API_KEY=
SERPER_API_KEY_2=
# ...sampai SERPER_API_KEY_5

# Tavily (opsional, fallback Serper)
TAVILY_API_KEY_1=
# ...sampai TAVILY_API_KEY_5

# Google CSE (opsional, last resort)
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_CX=

# Vercel Cron Secret
CRON_SECRET=isi_random_string_panjang
```

### 3. Setup Database

Jalankan schema di Supabase SQL Editor:

```bash
# Buka Supabase Dashboard → SQL Editor → paste isi file:
supabase/schema.sql
supabase/seed.sql   # (opsional, untuk data contoh)
```

### 4. Jalankan Development Server

```bash
pnpm dev
```

Aplikasi tersedia di `http://localhost:3000`.

---

## 📜 Scripts

| Perintah | Keterangan |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm start` | Production server |
| `pnpm lint` | Lint kode |
| `pnpm worker` | Jalankan tracking worker via CLI |

---

## 🌐 API Endpoints

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/admin/alumni` | Daftar alumni (dengan filter & pagination) |
| POST | `/api/admin/alumni` | Import alumni massal via CSV |
| GET | `/api/admin/reports` | Laporan tracking seluruh alumni |
| GET | `/api/admin/search-profiles` | Daftar search profile alumni |
| POST | `/api/tracking/run` | Mulai tracking manual |
| POST | `/api/tracking/stop` | Hentikan tracking yang berjalan |
| GET | `/api/tracking/jobs` | Daftar tracking job |
| GET | `/api/tracking/results` | Hasil tracking alumni |
| POST | `/api/tracking/confirm` | Konfirmasi/tolak hasil tracking |
| POST | `/api/tracking/verify` | Verifikasi data dari file |
| GET | `/api/alumni/profile` | Profil alumni (self) |
| POST | `/api/alumni/milestones` | Tambah milestone karier |
| GET | `/api/cron/tracking` | Endpoint cron job (dipanggil Vercel) |
| GET | `/api/setting/graduation-years` | Daftar tahun lulus tersedia |

---

## 🤖 Cara Kerja Sistem Tracking

Tracking alumni berjalan secara bertahap dengan mekanisme fallback:

```
Alumni → Search Profile → Gemini Standalone
                              ↓ (jika kosong)
                         Serper Web Search
                              ↓ (jika quota habis)
                         Tavily Search
                              ↓ (jika quota habis)
                         Google CSE
                              ↓
                    Gemini Extraction (+ konteks web)
                              ↓
                    Disambiguation & Scoring
                              ↓
              ┌───────────────┴───────────────┐
         identified                      needs_review
       (confidence ≥ 0.5)           (confidence < 0.5)
              ↓                              ↓
      Simpan otomatis              Validasi manual admin
```

**Rate Limit Handling:**
- 7 Gemini API key dengan round-robin & exponential backoff
- 5 Serper key + 5 Tavily key dengan rotasi otomatis
- Cache hasil Gemini 1 jam (per kombinasi nama+prodi+tahun lulus)
- Batch 20 alumni per job, jeda 15 detik antar alumni

**Confidence Score** dihitung dari 5 komponen:

| Komponen | Bobot |
|---|---|
| Name match | 0–0.30 |
| Affiliation match | 0–0.30 |
| Timeline match | 0–0.20 |
| Field match | 0–0.10 |
| Cross-validation | 0–0.10 |

---

## 🧪 Pengujian Data Tracking

Tabel berikut merangkum hasil uji coba sistem terhadap **8 data point** yang perlu dilacak per alumni, berdasarkan data aktual yang sudah masuk ke sistem.

> **Keterangan status:**
> - ✅ **Terdeteksi Otomatis** — data berhasil ditemukan & disimpan oleh sistem AI tanpa intervensi.
> - ⚠️ **Terdeteksi Sebagian** — data masuk tetapi tidak konsisten atau perlu dikonfirmasi.
> - ❌ **Tidak Terdeteksi** — sistem tidak dapat menemukan data, memerlukan validasi manual admin.

### Tabel Pengujian Per Data Point

| No | Data yang Dilacak | Field di Sistem | Sumber Utama Deteksi | Status Deteksi | Keterangan |
|:--:|---|---|---|:--:|---|
| 1 | **LinkedIn URL** | `linkedin_url` (profil) + `detected_linkedin` (tracking) | Gemini standalone / Serper | ✅ Terdeteksi Otomatis | LinkedIn adalah platform publik dengan profil terindeks — tingkat keberhasilan tertinggi |
| 2 | **Instagram URL** | `instagram_url` + `detected_instagram` | Gemini standalone / Serper | ⚠️ Terdeteksi Sebagian | Profil privat tidak dapat diakses; akun publik terdeteksi jika namanya unik |
| 3 | **Facebook URL** | `facebook_url` + `detected_facebook` | Gemini standalone / Serper | ⚠️ Terdeteksi Sebagian | Nama umum menghasilkan banyak kandidat ambigu; perlu konfirmasi admin |
| 4 | **TikTok URL** | `tiktok_url` + `detected_tiktok` | Gemini / Serper | ❌ Tidak Terdeteksi | TikTok tidak terindeks baik di Google; data hampir selalu null — perlu input manual |
| 5 | **Email** | `email` (profil) + `detected_email` | Gemini standalone / web | ⚠️ Terdeteksi Sebagian | Email yang terpublikasi di web bisa terdeteksi; email personal jarang ditemukan |
| 6 | **No. HP** | `phone_number` (profil) + `detected_phone` | Gemini / Serper | ❌ Tidak Terdeteksi | Nomor HP sangat jarang dipublikasikan secara online — wajib validasi manual admin |
| 7 | **Tempat Bekerja** | `current_company` + `detected_company` | Gemini standalone / LinkedIn | ✅ Terdeteksi Otomatis | Perusahaan sering muncul di LinkedIn dan artikel; tingkat deteksi cukup tinggi |
| 8 | **Alamat Tempat Bekerja** | `work_address` + `detected_work_address` | Gemini / Serper | ⚠️ Terdeteksi Sebagian | Alamat kantor bisa ditemukan jika perusahaan terdaftar publik; sering hanya kota |
| 9 | **Posisi/Jabatan** | `current_position` + `detected_position` | Gemini standalone / LinkedIn | ✅ Terdeteksi Otomatis | Jabatan adalah data yang paling sering dipublikasikan alumni di LinkedIn |
| 10 | **Sektor Kerja** (PNS/Swasta/Wirausaha) | `employment_sector` + `detected_employment_type` | Gemini (klasifikasi dari nama perusahaan) | ⚠️ Terdeteksi Sebagian | Gemini mengklasifikasi otomatis dari nama perusahaan; BUMN kadang salah klasifikasi |
| 11 | **Sosmed Tempat Bekerja** | `company_social_media` + `detected_company_social` | Gemini / Serper | ❌ Tidak Terdeteksi | Sosmed kantor jarang terhubung langsung ke nama alumni — hampir selalu null |

---

### Ringkasan Status Deteksi

| Status | Jumlah Data Point | Data Point |
|---|:--:|---|
| ✅ Terdeteksi Otomatis | 3 | LinkedIn, Tempat Bekerja, Posisi/Jabatan |
| ⚠️ Terdeteksi Sebagian | 4 | Instagram, Facebook, Email, Alamat Kerja, Sektor Kerja |
| ❌ Tidak Terdeteksi (perlu validasi manual) | 3 | TikTok, No. HP, Sosmed Tempat Bekerja |

> **Catatan:** Data yang berstatus ⚠️ dan ❌ akan masuk ke antrian `needs_review` di dashboard admin dengan `confidence_score < 0.5`. Admin dapat memverifikasi dan mengisi data secara manual melalui halaman **Tracking → Validasi Manual**.

---

### Alur Validasi Manual Admin

Untuk data yang tidak terdeteksi otomatis, admin dapat melakukan:

1. Buka **Dashboard Admin → Tracking**.
2. Filter alumni dengan status `needs_review`.
3. Klik alumni yang ingin divalidasi → lihat bukti (`evidence`) yang ditemukan sistem.
4. Isi atau perbaiki data yang kurang (No. HP, TikTok, Sosmed Kantor, dll.).
5. Klik **Verifikasi** untuk mengubah status menjadi `identified`.

---

## ☁️ Deployment (Vercel)

```bash
# Deploy ke Vercel
vercel deploy
```

Tambahkan semua environment variable di **Vercel Dashboard → Settings → Environment Variables**.

Tracking otomatis berjalan via **Vercel Cron** setiap hari pukul 02.00 WIB:

```json
{
  "crons": [{ "path": "/api/cron/tracking", "schedule": "0 2 * * *" }]
}
```

Pastikan `CRON_SECRET` diisi dan nilainya sama antara `.env` dan Vercel.

---

## 🔐 Autentikasi & Hak Akses

| Role | Akses |
|---|---|
| **Admin** | Dashboard, manajemen alumni, tracking, laporan, validasi |
| **Alumni** | Profil sendiri, milestone karier, sertifikasi |

Autentikasi menggunakan **Supabase Auth** dengan middleware Next.js yang memeriksa sesi dan role setiap request.

---

## 📦 Dependensi Utama

- [`next`](https://nextjs.org/) v14 — Framework React (App Router)
- [`@supabase/ssr`](https://supabase.com/docs/guides/auth/server-side/nextjs) — Supabase untuk Next.js App Router
- [`recharts`](https://recharts.org/) — Grafik distribusi & status
- [`papaparse`](https://www.papaparse.com/) — Parsing CSV import alumni
- [`lucide-react`](https://lucide.dev/) — Icon set
- [`react-hot-toast`](https://react-hot-toast.com/) — Notifikasi toast
- [`date-fns`](https://date-fns.org/) — Manipulasi tanggal

---

## 📄 Lisensi

Proyek ini dikembangkan untuk keperluan akademis — Universitas Muhammadiyah Malang (UMM).
