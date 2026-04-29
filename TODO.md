# TODO: Fix Gemini API Rate Limiting — ✅ SELESAI

## Masalah
Error `All API keys exhausted. Cannot complete request.` saat tracking alumni. Semua key Gemini kena 429 (RPM limit).

## Perbaikan yang Dilakukan

### ✅ 1. `services/externalFetcher.ts`
- [x] Tambahkan cache sederhana (Map) untuk hasil Gemini agar alumni yang sama tidak di-request berulang dalam 1 jam
- [x] Perbaiki `geminiExtract`: tambahkan exponential backoff antar key (2s, 4s, 8s, 16s)
- [x] Tambahkan delay 500ms antar request Serper untuk mengurangi beban
- [x] Jika semua key 429, return null (jangan throw error) agar fallback ke search langsung

### ✅ 2. `services/trackingOrchestrator.ts`
- [x] Kurangi limit alumni per job dari 50 → 20
- [x] Tingkatkan delay antar alumni dari 10 detik → 15 detik (aman untuk 30 req/menit + overhead)
- [x] Hapus `fetchFromGeminiWithRetry` yang redundan — key rotation & backoff sudah ditangani di `externalFetcher.ts`
- [x] Panggil `fetchFromGemini` langsung — jika gagal, catch block menangkap dan fallback search tetap berjalan
- [x] Hapus `fetchWithRetry` yang juga tidak digunakan lagi

## Cara Kerja Setelah Perbaikan

1. **Cache**: Setiap hasil Gemini untuk kombinasi `nama|prodi|tahun_lulus` disimpan 1 jam. Alumni yang sama tidak akan dihit API lagi dalam 1 jam.
2. **Exponential Backoff**: Jika key-1 kena 429, tunggu 2 detik lalu coba key-2. Jika key-2 juga 429, tunggu 4 detik, dst.
3. **Return null (bukan throw)**: Jika semua key gagal, `geminiExtract` return `null`, sehingga `trackingOrchestrator` bisa lanjut ke fallback Brave/Google search tanpa error.
4. **Batch size kecil**: Max 20 alumni per job, dengan jeda 15 detik antar alumni = aman dari rate limit.

## Langkah Selanjutnya (Opsional)
- Jalankan tracking untuk 5 alumni sebagai test
- Monitor console log untuk memastikan `Cache hit` muncul untuk alumni yang sama
- Jika masih ada masalah, pertimbangkan tambah lebih banyak Gemini API key (buat project baru di https://aistudio.google.com)

