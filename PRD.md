# PRD: JagaDaerah

_Kompetisi WIA MIA 2026 — Tema: Designing Digital Futures, Powering Public Transparency_

## 1. Ringkasan Proyek

| Item                 | Keterangan                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nama produk          | JagaDaerah                                                                                                                                                                                                                          |
| Tema lomba           | Designing Digital Futures – Powering Public Transparency                                                                                                                                                                            |
| Konsep inti          | Website yang menerjemahkan data APBD kabupaten/kota dan data bencana tingkat provinsi menjadi ringkasan berbahasa sederhana, sehingga masyarakat awam bisa memahami konteks daerahnya tanpa harus membaca laporan resmi yang teknis |
| Cakupan wilayah      | Seluruh kabupaten/kota di Indonesia                                                                                                                                                                                                 |
| Deadline First Draft | 1 November 2026                                                                                                                                                                                                                     |
| Platform             | Web responsif, tanpa login                                                                                                                                                                                                          |
| Arsitektur hosting   | Frontend di Cloudflare Pages, REST API di Cloudflare Workers, PostgreSQL eksternal yang diakses melalui Cloudflare Hyperdrive                                                                                                       |
| Status dokumen       | Draft implementasi v1.2 — 17 Oktober 2026                                                                                                                                                                                           |

### 1.1 Keputusan Teknis yang Dikunci

| Area                      | Keputusan final                                     | Tidak digunakan                                           |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| Workspace/package manager | Bun workspaces + `bun.lock`                         | npm, pnpm, Yarn                                           |
| Formatter                 | Oxfmt, dijalankan dengan `bun run format`           | Prettier, Biome formatter, Bun formatter                  |
| Linter                    | Oxlint, dijalankan dengan `bun run lint`            | ESLint, Biome lint, Bun linter                            |
| Type checking             | TypeScript/Astro check melalui script Bun           | Mengandalkan lint sebagai pengganti tipe tanpa verifikasi |
| Unit test                 | Bun test                                            | Jest/Vitest untuk unit test umum                          |
| Frontend                  | Astro + React islands + Tailwind CSS                | SPA penuh tanpa kebutuhan                                 |
| Hosting frontend          | Cloudflare Pages                                    | Vercel/Netlify                                            |
| Backend                   | Elysia + CloudflareAdapter pada Cloudflare Workers  | Server Bun yang selalu hidup                              |
| Database                  | Managed PostgreSQL + Drizzle ORM melalui Hyperdrive | SQLite/file JSON sebagai sumber data production           |
| Schema dan migration      | Drizzle schema + Drizzle Kit migration files        | Schema push langsung pada staging/production              |
| ETL                       | Python/pandas, terpisah dari runtime aplikasi       | Mengunduh XLSX pada request pengguna                      |

Jika bagian lain tampak bertentangan dengan tabel ini, tabel keputusan ini menjadi acuan dan bagian yang bertentangan harus diperbaiki sebelum implementasi.

## 2. Latar Belakang & Masalah

- Data APBD dan data bencana pemerintah sudah terbuka, tapi formatnya berupa tabel teknis (kode rekening, nilai kerusakan, dsb.) yang sulit dipahami masyarakat umum.
- Portal-portal data daerah tersebar di banyak domain berbeda, membuat warga sulit membandingkan daerahnya dengan daerah lain.
- Akibatnya transparansi anggaran dan risiko bencana ada secara teknis, tapi tidak fungsional bagi publik.

## 3. Tujuan Produk

1. Menyajikan ringkasan anggaran dan risiko bencana satu daerah dalam satu halaman, dalam kalimat yang mudah dipahami.
2. Memungkinkan pengguna membandingkan daerahnya dengan daerah lain (opsional, tahap lanjut).
3. Memenuhi lima kriteria penilaian babak penyisihan: orisinalitas (20%), fungsionalitas (25%), desain (20%), konten (20%), kesesuaian tema (15%).

### 3.1 Indikator Keberhasilan

| Indikator                | Target First Draft                                                             | Target Final                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Daerah yang dapat dicari | Minimal 5 daerah contoh dari sedikitnya 2 provinsi                             | Seluruh kabupaten/kota yang memiliki data valid                                    |
| Keberhasilan pencarian   | Pengguna menemukan profil daerah dalam maksimal 3 interaksi                    | Sama                                                                               |
| Kelengkapan profil       | Anggaran, konteks bencana, sumber, dan tahun data tampil untuk daerah contoh   | Minimal 90% daerah memiliki data anggaran; data kosong dijelaskan secara eksplisit |
| Performa halaman         | LCP ≤ 2,5 detik pada koneksi seluler standar                                   | LCP ≤ 2,5 detik pada persentil ke-75                                               |
| Aksesibilitas            | Alur utama dapat digunakan dengan keyboard dan grafik memiliki alternatif teks | Target audit Lighthouse Accessibility ≥ 90                                         |
| Keandalan API            | Tidak ada error pada alur demo utama                                           | Target availability 99,5% selama masa penjurian                                    |

### 3.2 Non-Tujuan

- Produk bukan alat audit resmi dan tidak menyimpulkan ada/tidaknya korupsi.
- Produk tidak memberi prediksi bencana atau peringatan darurat.
- Produk tidak membandingkan kinerja daerah hanya berdasarkan satu angka tanpa konteks tahun dan cakupan data.
- Produk tidak menggantikan dokumen APBD, publikasi DJPK, BNPB, BPS, atau Kemendagri sebagai sumber resmi.

## 4. Target Pengguna

- Warga umum yang ingin tahu kondisi daerah tempat tinggalnya.
- Mahasiswa/jurnalis yang butuh data cepat untuk tulisan atau riset.
- Juri lomba, sebagai penilai fungsionalitas dan kedalaman pengolahan data.

### 4.1 Kebutuhan Utama Pengguna

| Persona            | Pertanyaan yang ingin dijawab                                               | Kebutuhan desain                                                        |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Warga umum         | “Berapa anggaran daerah saya dan seberapa banyak yang terealisasi?”         | Bahasa awam, angka ringkas, istilah dijelaskan                          |
| Mahasiswa/jurnalis | “Dari mana angka ini berasal dan dapatkah saya mengutipnya?”                | Tahun, sumber, tanggal pembaruan, metodologi, tautan sumber             |
| Juri               | “Apakah solusi benar-benar bekerja dan relevan dengan transparansi publik?” | Alur demo singkat, data nyata, error state yang matang, performa stabil |

### 4.2 User Story Prioritas

- Sebagai warga, saya dapat mencari nama kabupaten/kota agar langsung menemukan profil daerah saya.
- Sebagai warga, saya dapat memahami realisasi anggaran tanpa menghitung persentase sendiri.
- Sebagai pengguna, saya dapat membedakan data kabupaten/kota dari data bencana tingkat provinsi.
- Sebagai peneliti, saya dapat melihat sumber, tahun, dan tanggal pemrosesan setiap dataset.
- Sebagai pengguna dengan koneksi lambat, saya tetap memperoleh informasi inti tanpa menunggu JavaScript berat.

## 5. Lingkup (Scope)

### Masuk lingkup — First Draft (1 Nov 2026)

- Landing page.
- Halaman pencarian/pilih daerah.
- Halaman profil 1 daerah contoh, berisi modul anggaran + modul bencana.

### Tambahan lingkup (disetujui pemilik produk, 17 Oktober 2026)

- Peta choropleth kabupaten/kota di landing page: warna menurut persentase realisasi belanja dibanding median nasional, dengan tooltip, klik membuka profil, filter provinsi (zoom), legenda teks, dan tabel alternatif yang dapat dioperasikan dengan keyboard. Peta dasar landing memakai ubin vektor CARTO (MapLibre, berkas pekerja di situs sendiri). Poligon kabupaten/kota tetap dari batas resmi, bukan dari peta dasar. Lapisan lain pada peta yang sama: jumlah rumah sakit dan jumlah sekolah (lima kelompok menurut peringkat jumlah, bukan per penduduk). Lapisan listrik mewarnai rasio elektrifikasi 2024 per provinsi (nasional 99,83%): setiap kabupaten/kota dalam satu provinsi memakai angka provinsi itu, dengan ambang tetap, bukan peringkat. Setiap profil menampilkan peta persebaran provinsinya (rumah sakit, sekolah, listrik) dengan daerah tersebut diuraikan, tetangga dapat diklik, dan tabel alternatif. Batas wilayah: `cahyadsn/wilayah_boundaries` (MIT, commit dipin), disederhanakan oleh `tools/etl`.
- Bagian "Harta kekayaan pejabat daerah" di profil (keputusan pemilik, 17 Oktober 2026, menggantikan keputusan sebelumnya): harta kekayaan pejabat daerah dari LHKPN yang dipublikasikan KPK, ditampilkan hanya bila ada sumber resminya. Setiap angka wajib berlabel tahun laporan, jabatan pada tahun laporan tersebut, sumber resmi, dan tanggal pemrosesan, disajikan netral tanpa menuduh atau menyimpulkan korupsi, dan angka tanpa sumber resmi tidak dipublikasikan. Keputusan pemilik adalah menampilkan angka; dasar penggunaan ulangnya dicatat sebagai keputusan pemilik yang masih terbuka, dengan asumsi kerja bahwa pengumuman LHKPN memang diwajibkan undang-undang, sehingga sisa risiko penggunaan ulang (tidak ada izin tertulis dari KPK, hanya pernyataan hak cipta yang dilindungi) diterima secara sadar. Bila KPK kemudian menyatakan syarat yang melarang publikasi ulang, angka ditarik dan bagian ini kembali hanya menautkan ke sumber resmi. Identitas pribadi di luar nama publik dan jabatan tidak disimpan; data pribadi tunduk pada UU PDP No. 27 Tahun 2022.

- Modul "Dana bagi hasil sumber daya alam" di profil (disetujui pemilik, 17 Oktober 2026): Dana Bagi Hasil SDA (minyak bumi, gas bumi, minerba, kehutanan, perikanan, panas bumi) dan DBH Perkebunan Sawit yang **diterima** kabupaten/kota, dari ekspor TKDD DJPK. Selalu diberi label bahwa angka ini bukan ukuran kekayaan/cadangan alam daerah; nilai DJPK dibulatkan ke Rp10 juta.
- Nama kepala daerah: **disetujui** (keputusan pemilik, 17 Oktober 2026, menggantikan penundaan pada hari yang sama). Profil menampilkan bupati/wali kota dan wakilnya yang menjabat, disertai gelar "Plt" untuk pelaksana tugas dan periode jabatan. Sumbernya daftar pejabat incumbent di Wikipedia bahasa Inggris, dicocokkan dengan daftar calon resmi KPU Pilkada 2024; hasil pencocokan dinyatakan terbuka di profil ("Cocok dengan daftar calon KPU" atau "Belum cocok dengan data KPU"), dan kabupaten/kota administrasi DKI Jakarta diberi label "Diangkat, bukan lewat Pilkada" karena tidak menyelenggarakan Pilkada. Setiap profil menautkan halaman sumber Wikipedia pada revisi yang dipakai (URL `oldid`, sehingga nomor revisi dapat ditelusuri) beserta tanggal revisinya, dan foto dari Wikimedia Commons ditampilkan dengan lisensi serta pemiliknya. Nama pejabat tetap ditampilkan bila belum ada padanan di daftar KPU, dengan label apa adanya.

### Tambahan lingkup (18 Oktober 2026)

- Realisasi belanja menurut fungsi (urusan) tahun 2024 dari seri data DJPK, per kabupaten/kota. Tagging kesehatan dan pendidikan digabung ke fungsi induknya. Ini realisasi, bukan pagu, dan bukan rincian program atau dinas.
- Realisasi pendapatan daerah menurut jenis tahun 2024 dari berkas ringkas DJPK. Angka ini kas daerah, bukan penghasilan warga.
- Jumlah rumah sakit (daftar SIRS Kemenkes) dan jumlah satuan pendidikan SD, SMP, SMA, dan SMK (portal referensi Kemendikdasmen). Nama wilayah yang tidak unik tidak dihitung. SLB tidak dijumlahkan. Bukan tempat tidur, bukan murid, dan bukan tahun ajaran.
- Tutupan lahan 2023 tingkat provinsi dari rekapitulasi PKTL KLHK: hutan primer, hutan sekunder, hutan tanaman, dan bukan hutan. Bukan data kabupaten/kota, bukan daftar spesies, dan tidak memisah mangrove, sawah, perkebunan, atau permukiman.
- Rasio elektrifikasi 2024 tingkat provinsi dari ESDM Statistik Ketenagalistrikan Tabel 7 (nasional 99,83%). Setiap kabupaten/kota di provinsi itu memakai angka yang sama. Rasio elektrifikasi per kabupaten/kota tidak dipasang: ESDM tidak menerbitkan satu berkas per kabupaten/kota. Jumlah penduduk yang dipasang adalah catatan Dukcapil 31 Desember 2024, bukan proyeksi BPS. LHKPN tetap hanya tautan ke e-LHKPN KPK; angka harta tidak disalin.
- Opini BPK atas laporan keuangan pemerintah daerah, dari unduhan Portal Data BPK, tahun laporan 2016–2024. Empat kode resmi: WTP, WDP, TW, TMP. Kabupaten dan kota administrasi DKI Jakarta memakai opini provinsi dan diberi label tingkat provinsi. Opini ini bukan penilaian pejabat dan bukan temuan korupsi.

### Masuk lingkup — Final (menyusul, di luar PRD ini)

- Seluruh kabupaten/kota aktif dengan data.
- Perbandingan antar-daerah.
- Peta interaktif sebaran bencana.

### Di luar lingkup

- Rincian anggaran per program/dinas (data terlalu granular dan tidak tersedia nasional).
- Login/akun pengguna.
- Data real-time (semua data bersifat historis/tahunan, diolah statis).
- Sistem pengaduan masyarakat, komentar, voting, dan moderasi konten.
- Dashboard internal untuk mengedit data secara manual.
- Aplikasi mobile native.

## 6. Sitemap

```
Home (Landing Page)
├── Cari Daerah (search/pilih provinsi > kabupaten/kota)
├── Sumber data (/sumber)
└── Profil Daerah [slug kabupaten/kota]
    ├── Pejabat yang menjabat
    ├── Ringkasan (ringkasan bahasa sederhana)
    ├── Modul Anggaran (APBD)
    ├── Rincian jenis belanja
    ├── Realisasi belanja menurut fungsi
    ├── Pendapatan daerah
    ├── Opini laporan keuangan (BPK)
    ├── Dana bagi hasil SDA
    ├── Modul Bencana
    ├── Penduduk, rumah sakit, dan sekolah
    ├── Tutupan lahan (provinsi)
    └── Sumber Data & Metodologi
```

## 7. Fitur per Halaman

### 7.1 Landing Page

- Judul + penjelasan singkat tujuan website (1–2 kalimat), ditulis dalam bahasa awam.
- Search bar dengan autocomplete: mengetik nama daerah langsung memunculkan daftar kabupaten/kota yang cocok (island React, dipanggil lewat ky ke endpoint `/daerah/search`).
- Highlight 2–3 contoh daerah (shortcut) yang datanya sudah lengkap, supaya pengguna/juri bisa langsung mencoba tanpa mengetik.
- 3 angka ringkas di bawah hero (mis. jumlah daerah tercakup, tahun data, jumlah sumber resmi) sebagai bukti kredibilitas data.
- Kondisi terkini seluruh Indonesia di landing (`GET /v1/terkini`): gempa terbaru dari daftar BMKG, judul peringatan dini cuaca yang sedang ditayangkan, dan indeks udara stasiun KLH/BPLH (ISPU). Indeks udara adalah pembacaan stasiun, bukan rata-rata kabupaten, dengan saran yang sama seperti situs ISPU. Ini bukan cuaca satu daerah; cuaca kabupaten/kota tetap di profil. Satu umpan yang gagal tidak menyembunyikan umpan yang lain.
- CTA menuju halaman pencarian penuh untuk pengguna yang ingin menjelajah semua daerah.
- Kriteria selesai: hero + search tampil < 2 detik di koneksi standar, search bar bisa dioperasikan dengan keyboard saja, layout responsif dari lebar HP sampai desktop.

### 7.2 Halaman Cari Daerah

- Dropdown bertingkat: pilih provinsi → daftar kabupaten/kota termuat sesuai provinsi terpilih (data dari endpoint `/provinsi` dan `/provinsi/:kode/daerah`).
- Kolom pencarian bebas (nama daerah) sebagai alternatif dropdown, hasil difilter saat mengetik.
- Status kosong yang jelas kalau daerah belum tersedia datanya, dengan saran daerah terdekat yang sudah ada datanya (bukan sekadar "tidak ditemukan").
- Hasil pilih langsung menuju halaman profil daerah (`/daerah/[slug]`).
- Kriteria selesai: bisa dioperasikan tanpa mouse, state loading terlihat saat daftar kabupaten/kota masih dimuat.

### 7.3 Halaman Profil Daerah (halaman fungsional utama)

- **Header**: nama daerah, provinsi, tahun data, badge sumber data (DJPK/BNPB).
- **Pejabat yang menjabat**: bupati/wali kota dan wakilnya (badge "Plt" bila pelaksana tugas), periode jabatan, hasil pencocokan terhadap daftar calon resmi KPU yang dinyatakan terbuka ("Cocok dengan daftar calon KPU", "Belum cocok dengan data KPU", atau "Diangkat, bukan lewat Pilkada" untuk kabupaten/kota administrasi DKI Jakarta), disertai tautan sumber Wikipedia pada revisi yang dipakai (URL `oldid` dengan tanggal revisi) dan kredit foto Wikimedia Commons dengan lisensinya.
- **Ringkasan bahasa sederhana**: 2–3 kalimat otomatis dari data, contoh: "Dari tiap Rp100 ribu anggaran \[daerah\] tahun \[tahun\], Rp\[x\] ribu sudah direalisasikan." Dihasilkan dari rumus tetap di backend (bukan diketik manual per daerah), supaya konsisten saat cakupan diperluas ke ratusan daerah.
- **Modul Anggaran**:
  - Total anggaran vs realisasi (angka + persentase realisasi).
  - Grafik batang anggaran vs realisasi (komponen Chart dari almach/ui).
  - Catatan singkat apakah persentase realisasi di atas/di bawah rata-rata nasional tahun yang sama.
  - Badge status sederhana (mis. "Realisasi tinggi" / "Realisasi rendah") dengan ambang batas yang dijelaskan di halaman metodologi.
- **Realisasi belanja menurut fungsi**: sembilan fungsi APBD tahun 2024 (pelayanan umum, ketertiban, ekonomi, lingkungan, perumahan, kesehatan, pariwisata, pendidikan, perlindungan sosial). Label tahunnya tetap 2024 walaupun pemilih tahun profil menunjuk tahun lain. Anggaran per fungsi tidak digabung dari berkas bertanggal lain.
- **Pendapatan daerah**: realisasi 2024 menurut jenis (pajak, retribusi, hasil kekayaan, PAD lain, transfer, hibah, dan lain-lain). Labelnya kas daerah, bukan penghasilan warga.
- **Penduduk, rumah sakit, dan sekolah**: jumlah jiwa pada Data Konsolidasi Bersih Ditjen Dukcapil per 31 Desember 2024 (bukan Sensus BPS), plus jumlah fasilitas rumah sakit serta jumlah SD, SMP, SMA, dan SMK.
- **Kemiskinan dan penghidupan**: persentase dan jumlah penduduk miskin Susenas Maret 2025, garis kemiskinan, PDRB per kapita 2025 (hasil ekonomi per orang, bukan gaji), dan Indeks Pembangunan Manusia 2025 beserta pengeluaran riil per kapita yang disesuaikan.
- **Sanitasi layak**: persentase rumah tangga kabupaten/kota tahun 2025 (BPS, indikator 6.2.1*, Susenas KOR). Artinya jamban leher angsa sendiri atau bersama dengan tangki septik atau pengolahan air limbah. Bukan status desa bebas buang air besar sembarangan, dan bukan sanitasi aman. Sel kosong bukan nol.
- **Tutupan lahan**: empat kelas tahun 2023 untuk provinsi induk, dengan label tingkat provinsi.
- **Modul Bencana**:
  - Jumlah kejadian bencana tahun terakhir, per jenis, di level provinsi.
  - Korban terdampak/meninggal/hilang (jika tersedia di sumber).
  - Grafik batang jenis bencana terbanyak.
  - Label eksplisit "data tingkat provinsi" supaya tidak disalahartikan sebagai data kabupaten/kota.
- **Peta lokasi**: peta provinsi dengan kabupaten/kota yang dibuka disorot (dekoratif; lokasi juga ditulis sebagai teks).
- **Harta kekayaan pejabat daerah**: ringkasan harta kekayaan pejabat dari LHKPN yang dipublikasikan KPK, selalu dengan tahun laporan, jabatan saat tahun laporan, sumber, dan tanggal pemrosesan. Angka tanpa sumber resmi tidak ditampilkan ("Data belum tersedia"). Harta dan utang yang dideklarasikan ditampilkan berdampingan; bila salah satunya tidak tersedia, UI menjelaskan keterbatasan itu alih-alih menyajikan harta saja. Keputusan menampilkan angka sudah diambil pemilik; yang masih terbuka hanya dasar penggunaan ulangnya — menunggu pernyataan tertulis dari KPK, atau memakai dasar bahwa pengumuman LHKPN memang diwajibkan undang-undang dengan atribusi dan penyajian netral, menerima sisa risiko penggunaan ulang. Aturan detail dan status keputusan ada di `docs/decisions/0003-publish-lhkpn-figures.md`; operasional di `docs/SECURITY.md`.
- **Sumber Data**: tautan/keterangan sumber resmi, tahun data, dan tanggal terakhir ETL dijalankan — untuk kredibilitas konten.
- **Navigasi**: tombol kembali ke pencarian, dan tautan "bandingkan dengan daerah lain" (nonaktif/placeholder di First Draft, aktif di versi final).
- Kriteria selesai: halaman tetap bisa dibaca kalau salah satu modul datanya kosong (tidak membuat seluruh halaman gagal render), grafik punya alt text, dan semua angka memakai format ribuan Indonesia.

### 7.4 Fitur Teknis (Non-UI)

- Validasi parameter, query, dan bentuk data internal dengan skema Zod. Kontrak response diekspor dari package bersama agar frontend dan backend memakai tipe yang sama.
- Klien API type-safe memakai Eden Treaty (tipe dari `App` Elysia, import type-only) dan memvalidasi respons dengan schema Zod bersama; server state dikelola TanStack Query (ADR 0002).
- Error handling konsisten: tiap endpoint mengembalikan bentuk error yang sama (kode, pesan, status HTTP), ditangani di satu tempat oleh klien frontend.
- Cache response publik melalui Cloudflare Cache API/HTTP `Cache-Control`; data baru dipublikasikan setelah proses ETL tervalidasi.
- Structured logging di Worker menggunakan JSON berisi request ID, path, status, durasi, dan kode error; tidak merekam data sensitif.
- Unit test untuk service layer backend (logika hitung persentase realisasi, ringkasan bahasa sederhana) terpisah dari controller, supaya mudah diuji tanpa menjalankan server penuh.
- Rate limiting dasar untuk endpoint pencarian apabila trafik publik membutuhkannya; endpoint seluruhnya bersifat read-only.

### 7.5 Aturan Tampilan dan Interpretasi Data

- Nilai rupiah utama ditampilkan ringkas, misalnya `Rp3,42 triliun`; nilai lengkap tersedia pada tooltip atau detail teks.
- Persentase memakai maksimal satu angka desimal dan pembagi nol menghasilkan status `data tidak cukup`, bukan `0%`.
- Data yang tidak tersedia ditampilkan sebagai “Data belum tersedia”, tidak dipaksa menjadi nol.
- Setiap angka selalu berdekatan dengan tahun/periode dan level wilayahnya.
- Warna merah/hijau tidak menjadi satu-satunya pembeda status; selalu disertai label atau ikon.
- Label “tinggi” dan “rendah” hanya digunakan jika ambang dan metode pembanding dijelaskan.
- Narasi tidak menggunakan bahasa menuduh. Contoh aman: “Realisasi tercatat 82,4%”; contoh yang dihindari: “Pemerintah gagal membelanjakan anggaran”.

## 8. Sumber Data & Skema

### 8.1 Dataset APBD (sumber: DJPK Kemenkeu, djpk.kemenkeu.go.id)

- File: "Data realisasi APBD kabupaten/kota seluruh Indonesia \[tahun\].xlsx".
- Cakupan: seluruh kabupaten/kota se-Indonesia dalam satu file, tersedia sejak TA 2006.
- Kolom relevan: kode wilayah, nama kabupaten/kota, anggaran, realisasi.
- Granularitas: total anggaran & realisasi per daerah (bukan per program/dinas).

### 8.2 Dataset Bencana (sumber: Portal Satu Data Bencana BNPB, data.bnpb.go.id)

- File: "Kompilasi Data Jumlah dan Dampak Kejadian Bencana \[tahun\]" — per provinsi, per jenis bencana.
- Kolom relevan: kode wilayah provinsi, nama provinsi, latitude/longitude, jumlah kejadian per jenis bencana (banjir, cuaca ekstrem, erupsi, gempa, karhutla, kekeringan, longsor, tsunami), korban meninggal/hilang/terdampak.
- Data tambahan opsional: DIBI (dibi.bnpb.go.id) untuk riwayat historis per kabupaten/kota 2000–sekarang.

### 8.3 Tabel Kode Wilayah (penghubung)

- Sumber: kode wilayah administrasi resmi Kemendagri/BPS (provinsi + kabupaten/kota).
- Fungsi: kunci penghubung (join key) antara dataset APBD (level kab/kota) dan dataset bencana (level provinsi).

### 8.4 Dataset LHKPN (sumber: publikasi KPK)

- Isi yang diambil hanya yang KPK sendiri publikasikan: nama pejabat, jabatan, total harta, total utang (utang adalah bagian dari formulir LHKPN; lihat `docs/SECURITY.md`), tahun/periode pelaporan, dan lembar pengumuman sebagai dokumen sumber.
- LHKPN bersifat tahunan: satu laporan mewakili periode 1 Januari–31 Desember dan tidak boleh disajikan sebagai harta terkini.
- Bidang di luar daftar itu (identitas pribadi, nomor laporan, alamat, dokumen pindaian) tidak diambil dan tidak disimpan.
- Dasar penggunaan ulang angka LHKPN adalah keputusan pemilik yang masih terbuka (opsi a: menunggu pernyataan KPK; opsi b: berdasarkan kewajiban pengumuman LHKPN menurut undang-undang, dengan atribusi dan penyajian netral). Tidak ditemukan izin tertulis dari KPK; sisa risiko penggunaan ulang diterima sadar oleh pemilik. Rincian di `docs/decisions/0003-publish-lhkpn-figures.md`.
- Sampai portal e-LHKPN menyediakan unduhan publik, profil hanya menautkan `https://elhkpn.kpk.go.id/` dan tidak menyimpan angka harta.

### 8.5 Realisasi belanja menurut fungsi (sumber: DJPK)

- Berkas: `31102025_Realisasi_Belanja_Daerah_2024.xlsx` pada seri data DJPK (`https://djpk.kemenkeu.go.id/?p=5412`), diperbarui 31 Oktober 2025.
- Satu baris per pemda per fungsi. Baris "Tagging" kesehatan dan pendidikan dijumlahkan ke fungsi induknya, bukan dihitung dua kali.
- Berkas itu hanya memuat realisasi. Pagu fungsi dari berkas anggaran bulan Juli 2024 tidak digabung.

### 8.6 Realisasi pendapatan daerah (sumber: DJPK)

- Berkas: `31102025_Data_Realisasi_Ringkas_APBD_2024.xlsx` pada seri data yang sama.
- Jenis di bawah "4. Pendapatan Daerah" dijumlahkan dan dicocokkan dengan baris total pada lembar ringkasan. Selisih lebih dari Rp1 menggagalkan build.
- Kolom pada lembar data bernama `nilaianggaran`; halaman seri menandai berkas sebagai realisasi. Pemda yang tidak ada di berkas dikosongkan, tidak diisi nol.

### 8.7 Rumah sakit dan satuan pendidikan

- Rumah sakit: daftar JSON publik SIRS Kemenkes. Wilayah dari nama kabupaten/kota di dalam provinsi, karena kode rumah sakit bukan kode Kemendagri. Empat ejaan yang merujuk satu daerah resmi ikut dihitung. Nama yang cocok dengan kabupaten dan kota sekaligus dihitung hanya bila koordinat pada peta SIRS (`list_prop_noncovid`) berada di dalam tepat satu dari dua batas resmi itu. Baris tanpa koordinat, di luar kedua batas, atau di dalam keduanya tidak dihitung. Nama, alamat, telepon, dan koordinat tidak disimpan.
- Halaman `/sumber` menuliskan penerbit, periode, tautan, dan batas pemakaian setiap data yang ditampilkan.
- Sekolah: halaman dikdas (SD, SMP) dan dikmen (SMA, SMK) pada `referensi.data.kemendikdasmen.go.id`. SLB tidak dijumlahkan. Halaman tidak mencetak tahun ajaran, jadi angka dilabeli sebagai hitungan saat berkas diambil.
- Jumlah penduduk kabupaten/kota adalah Data Konsolidasi Bersih Ditjen Dukcapil per 31 Desember 2024, bukan Sensus BPS. BPS tidak menyediakan satu berkas nasional berkode Kemendagri, dan portal provinsi tidak digabung. Tabel yang dipasang adalah satu berkas nasional berkode (`db/wilayah_penduduk.sql`). Jumlah kabupaten/kota di tiap provinsi sama dengan baris provinsinya, dan jumlah nasionalnya 284.973.643 jiwa, sama dengan rilis Dukcapil. Tiga baris dicek terhadap buku dinas yang mengutip rilis yang sama: Kabupaten Dairi 333.335, Kabupaten Gresik 1.327.497, Kota Cimahi 581.994.
- Rasio elektrifikasi memakai Tabel 7 Statistik Ketenagalistrikan 2024 (satu angka per provinsi). Peta tidak mengarang rasio kabupaten/kota.

### 8.8 Tutupan lahan provinsi (sumber: rekapitulasi PKTL KLHK 2023)

- Empat kelas dalam hektare: hutan primer, hutan sekunder, hutan tanaman, bukan hutan. Satuan sumber adalah ribu hektare.
- Tingkat provinsi saja. Host `statistik.menlhk.go.id` sudah tidak terurai; checksum pada artefak adalah tabel yang tersimpan.
- Katalog Satu Data Indonesia 2014–2018 tidak dipakai.

### 8.9 Skema Data Hasil Olahan (contoh struktur JSON per daerah)

```json
{
  "kode_wilayah": "3273",
  "nama_daerah": "Kota Bandung",
  "provinsi": "Jawa Barat",
  "tahun_data": 2024,
  "anggaran": {
    "total_anggaran": 0,
    "total_realisasi": 0,
    "persen_realisasi": 0
  },
  "bencana_provinsi": {
    "jumlah_kejadian": 0,
    "per_jenis": { "banjir": 0, "longsor": 0 },
    "korban_meninggal": 0,
    "korban_terdampak": 0
  },
  "harta_pejabat": {
    "tahun_laporan": 2024,
    "jabatan_saat_lapor": "bupati",
    "total_harta": "0",
    "total_utang": "0",
    "sumber": "",
    "tanggal_proses": "2026-10-17"
  }
}
```

### 8.10 Kemiskinan, hasil ekonomi per orang, dan IPM (sumber: BPS)

- Kemiskinan: buku Data dan Informasi Kemiskinan Kabupaten/Kota Tahun 2025, Tabel 2.1. BPS menghitungnya dari Susenas Maret 2025. Jumlah penduduk miskin dipasang dalam ribu jiwa, sama seperti tabel, dan tidak dibagi dengan catatan Dukcapil.
- Hasil ekonomi per orang: PDRB per kapita atas dasar harga berlaku 2025 dari buku Produk Domestik Regional Bruto Kabupaten/Kota di Indonesia 2021–2025. Halaman menyebutnya hasil ekonomi daerah dibagi jumlah penduduk, bukan gaji. BPS menandai 2025 sebagai angka sangat sementara. Empat provinsi hasil pemekaran Papua tidak memuat angka 2025 yang bisa dibaca, jadi selnya kosong.
- IPM: Lampiran 2 buku Indeks Pembangunan Manusia 2025, plus pengeluaran riil per kapita yang disesuaikan. Itu komponen IPM, bukan gaji.
- Nama BPS dicocokkan ke kode Kemendagri di dalam provinsi yang sama. Nama yang tidak cocok satu-satu dikosongkan, tidak ditebak.

### 8.11 Sanitasi layak (sumber: BPS)

- Tabel statistik 6.2.1*, persentase rumah tangga menurut kabupaten/kota, tahun 2025. BPS menghitungnya dari Susenas KOR.
- Definisi pada tabel: jamban leher angsa milik sendiri atau bersama, dan pembuangan akhir tinja berupa tangki septik atau sistem pengolahan air limbah. Halaman menyebut itu sanitasi layak, bukan sanitasi aman dan bukan status desa stop buang air besar sembarangan.
- Kode BPS tidak disalin menjadi kode Kemendagri. Nama dicocokkan. Mamuju Utara dibaca sebagai Kabupaten Pasangkayu (PP Nomor 61 Tahun 2017). Sel tanpa angka, termasuk Kabupaten Puncak pada tabel 29 Agustus 2026, dikosongkan dan tidak diisi nol.

## 9. Alur Pengolahan Data (ETL)

1. Unduh file APBD nasional (XLSX) dan file bencana nasional (XLSX) sekali secara manual.
2. Bersihkan dan ubah menjadi data terstruktur per kode wilayah memakai skrip Python/pandas.
3. Validasi kode wilayah, tipe angka, duplikasi, nilai negatif, kelengkapan tahun, dan konsistensi agregat. Baris yang gagal masuk ke laporan penolakan dan tidak langsung dipublikasikan.
4. Muat hasil bersih ke tabel staging PostgreSQL dalam satu `dataset_version` baru.
5. Jalankan pemeriksaan kualitas; jika lolos, tandai versi tersebut sebagai aktif dalam transaksi. API hanya membaca versi aktif sehingga pengguna tidak melihat data setengah terimpor.
6. Cloudflare Worker mengekspos data PostgreSQL lewat REST API tervalidasi Zod (lihat bagian 16). Koneksi database menggunakan binding Hyperdrive.
7. Frontend Astro memanggil API melalui `ky`; komponen interaktif hanya di-hydrate pada pencarian dan grafik.
8. Karena data sumber sudah diunduh dan disimpan sendiri, demo tidak bergantung pada ketersediaan djpk.kemenkeu.go.id atau data.bnpb.go.id saat dinilai juri.
9. Untuk pembaruan data, jalankan ulang ETL dan aktifkan versi dataset baru. Worker tidak perlu di-restart atau di-deploy ulang.

### 9.1 Tahapan ETL yang Dapat Diaudit

`extract → normalize → map-region → validate → load-staging → quality-check → publish`

- **Extract:** simpan file mentah beserta nama file, URL sumber, tanggal unduh, dan checksum SHA-256.
- **Normalize:** seragamkan nama kolom, format kode wilayah, angka rupiah, nilai kosong, serta penamaan jenis bencana.
- **Map-region:** hubungkan data melalui kode resmi; pencocokan berbasis nama hanya menjadi fallback dan harus masuk log review. Untuk LHKPN yang hanya menyediakan nama pejabat, pencocokan dilakukan melalui artefak CSV yang direview di `tools/etl/reference/` beserta README-nya; kecocokan yang belum jelas atau bertentangan memblokir publikasi baris tersebut.
- **Validate:** tolak duplikasi kunci `(kode_wilayah, tahun)`, angka tidak valid, dan wilayah yang tidak dikenal.
- **Load staging:** gunakan batch insert/upsert dalam transaksi; jangan mengubah versi aktif.
- **Quality check:** bandingkan jumlah baris, total agregat, persentase null, dan selisih terhadap versi sebelumnya.
- **Publish:** aktifkan `dataset_version` baru, catat siapa/kapan proses dijalankan, kemudian purge cache endpoint terkait.

### 9.2 Kriteria Lolos Kualitas Data

- 100% baris publik memiliki kode wilayah valid dan tahun data.
- Tidak ada duplikasi pada kunci unik tabel fakta.
- `total_anggaran ≥ 0`, `total_realisasi ≥ 0`, dan persentase dihitung backend, bukan disimpan sebagai input mentah.
- Selisih jumlah baris lebih dari 10% dari versi sebelumnya memerlukan review manual.
- Setiap versi dataset memiliki minimal satu sumber dan checksum file mentah.
- Baris LHKPN tanpa sumber resmi, tahun laporan, jabatan pada tahun itu, atau hasil pencocokan wilayah yang direview tidak ikut dipublikasikan.
- Aktivasi versi dibatalkan seluruhnya jika pemeriksaan wajib gagal.

## 10. Tech Stack

| Layer                           | Pilihan                                                  | Alasan                                                                                                                             |
| ------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Frontend (framework)            | Astro                                                    | Halaman utama diprerender menjadi HTML statis; komponen interaktif (search dan grafik) hanya di-hydrate di bagian yang membutuhkan |
| Styling                         | Tailwind CSS                                             | Utility-first, cepat membangun layout konsisten dan responsif                                                                      |
| UI components                   | almach/ui (React, dipakai sebagai Astro island)          | Komponen siap pakai dan bertipe TypeScript (Select, Tabs, Chart, Table), dipasang hanya di titik interaktif                        |
| Backend (framework)             | Elysia + CloudflareAdapter                               | API bertipe dengan adapter Workers; aplikasi dikompilasi dan tidak menjalankan listener Bun                                        |
| Runtime backend                 | Cloudflare Workers                                       | API stateless berjalan di jaringan Cloudflare tanpa server yang harus dikelola                                                     |
| Validasi data dan request       | Zod                                                      | Memvalidasi query/param/body tiap endpoint, sekaligus jadi sumber tipe TypeScript (schema-first)                                   |
| Integrasi tipe Frontend-Backend | Package `contracts` (Zod) + tipe `App` Elysia untuk Eden | Zod tetap sumber kontrak runtime; tipe Eden hanya compile-time dan tidak ikut ke bundle browser                                    |
| HTTP client                     | Eden Treaty + TanStack Query                             | Tipe end-to-end dari `App` Elysia; respons tetap divalidasi Zod saat runtime karena Pages dan Worker di-deploy terpisah (ADR 0002) |
| Grafik                          | Chart dari almach/ui atau Recharts                       | Cukup untuk grafik batang anggaran dan bencana                                                                                     |
| Database hasil ETL              | PostgreSQL terkelola                                     | Relasional, mendukung constraint, transaksi, indeks, versi dataset, dan query agregasi                                             |
| ORM dan schema                  | Drizzle ORM + Drizzle Kit                                | Query bertipe, schema TypeScript, serta migration SQL yang dapat direview dan di-version-control                                   |
| Koneksi Worker–database         | Cloudflare Hyperdrive + Drizzle `node-postgres` + `pg`   | Drizzle menjadi API akses data; `pg` hanya driver bawah untuk pooling Hyperdrive dan tidak digunakan sebagai pola repository kedua |
| Hosting frontend                | Cloudflare Pages                                         | Deploy dari Git, preview per branch/PR, CDN global untuk aset statis Astro                                                         |
| Hosting backend                 | Cloudflare Workers                                       | Endpoint API terpisah, misalnya `api.jagadaerah.id`                                                                                |
| Pengolahan data (ETL)           | Python + pandas, dijalankan lokal atau CI manual         | Ekosistem matang untuk membaca XLSX; ETL bukan bagian dari request Worker                                                          |
| Monorepo/build                  | Bun workspaces                                           | Satu lockfile, instalasi deterministik, filtering script per workspace, serta test runner bawaan untuk TypeScript                  |

Catatan: “semuanya di Cloudflare” pada lapisan aplikasi berarti frontend, backend, DNS, CDN, TLS, dan koneksi edge dikelola melalui Cloudflare. PostgreSQL tetap membutuhkan layanan PostgreSQL yang kompatibel dan dihubungkan ke Workers melalui Hyperdrive; database bukan proses yang dijalankan di Pages atau Workers.

## 11. Pemetaan ke Kriteria Penilaian

| Kriteria           | Bobot | Bagaimana PRD ini memenuhi                                                                           |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------------- |
| Orisinalitas       | 20%   | Fokus pada "penerjemahan data jadi kalimat sederhana", bukan sekadar menampilkan angka/grafik mentah |
| Fungsionalitas     | 25%   | Alur tunggal (cari daerah → lihat profil), data statis sehingga semua fitur pasti berjalan saat demo |
| Desain & Estetika  | 20%   | Layout konsisten 1–2 komponen yang dipakai ulang di semua halaman daerah                             |
| Konten & Informasi | 20%   | Data bersumber resmi (DJPK, BNPB), dicantumkan sumber & tahun data di tiap halaman                   |
| Kesesuaian Tema    | 15%   | Data pemerintah diolah dan disajikan secara fungsional sesuai deskripsi tema                         |

## 12. Linimasa Menuju First Draft (1 November 2026)

| Tahap                                                          | Target Selesai          |
| -------------------------------------------------------------- | ----------------------- |
| Unduh & bersihkan dataset APBD + bencana nasional              | Minggu 1                |
| Buat skrip ETL → staging dan tabel aktif PostgreSQL            | Minggu 1                |
| Bangun landing page + halaman cari daerah                      | Minggu 2                |
| Bangun halaman profil daerah (1 daerah contoh)                 | Minggu 2                |
| Tulis README.md + sitemap + wireframe untuk dokumen submission | Minggu 3                |
| Ambil screenshot (landing page + 1 halaman lain)               | Minggu 3                |
| Review internal & finalisasi dokumen PDF submission            | Minggu 3, sebelum 1 Nov |

## 13. Risiko & Mitigasi

| Risiko                                                                          | Mitigasi                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data APBD DJPK hanya granularitas total, bukan per sektor                       | Jelaskan di halaman "Sumber Data" bahwa angka adalah ringkasan total; jadikan rincian per sektor sebagai fitur lanjutan opsional                                                                                                  |
| Data bencana BNPB hanya level provinsi (bukan kab/kota) untuk kompilasi tahunan | Tampilkan bagian bencana sebagai data tingkat provinsi, dengan label yang jelas, bukan diklaim data kab/kota                                                                                                                      |
| Waktu pengerjaan ETL molor                                                      | Prioritaskan 1 provinsi/beberapa daerah contoh dulu untuk First Draft, lalu perluas ke seluruh Indonesia untuk versi final                                                                                                        |
| File XLSX nasional berubah format di update berikutnya                          | Simpan salinan file mentah yang sudah diunduh di repo/drive sebagai cadangan                                                                                                                                                      |
| Angka LHKPN dipublikasikan tanpa izin penggunaan ulang tertulis dari KPK        | Keputusan pemilik: publikasi memakai dasar bahwa pengumuman LHKPN diwajibkan undang-undang, dengan atribusi KPK, penyajian netral, dan kesiapan menarik angka bila KPK menyatakan syarat yang melarang publikasi ulang (ADR 0003) |

## 14. Deliverable First Draft Submission (sesuai syarat lomba)

- Link repository publik (GitHub/GitLab) dengan README.md berisi: judul + deskripsi singkat, tech stack, cara menjalankan (clone → install → run), progress saat ini.
- Dokumen PDF (format nama: WIA\_FSDMIA2026\_NamaTim, maks 10 halaman, maks 10 MB) berisi: konsep singkat website, sitemap, wireframe/mockup sederhana, penjelasan fitur yang direncanakan, screenshot minimal 2 halaman yang sudah dikerjakan (wajib landing page + 1 halaman lain).

## 15. Arsitektur Sistem

Tiga package utama berada dalam satu monorepo: frontend, Worker API, dan kontrak bersama. ETL ditempatkan sebagai tool terpisah agar dependensi pandas tidak masuk ke deployment aplikasi.

```text
[ Browser pengguna ]
        │ HTTPS
        ▼
[ Cloudflare Pages + CDN ]
[ Astro HTML statis + React islands ]
        │ GET api.jagadaerah.id/v1/*
        ▼
[ Cloudflare Worker ]
[ Elysia → validation → service → Drizzle repository ]
        │ binding Hyperdrive
        ▼
[ Cloudflare Hyperdrive ]
        │ pooled PostgreSQL connection
        ▼
[ Managed PostgreSQL ]
        ▲
        │ transaksi publish dataset
[ ETL Python/pandas ] ← [ XLSX DJPK + BNPB + referensi wilayah ]
```

### 15.1 Struktur Monorepo Bun Workspaces

```text
apps/
  web/                 # Astro, Tailwind, React islands; deploy ke Pages
  api/                 # Elysia Worker; deploy dengan Wrangler
packages/
  contracts/           # Zod schema, DTO, konstanta error
  config/              # konfigurasi TypeScript/lint bersama jika sudah dipakai >1 workspace
  ui/                  # komponen lintas halaman; jangan menjadi design system berlebihan
tools/
  etl/                 # Python, mapping wilayah, validasi, laporan import
  clean.ts             # clean aman berbasis allowlist, dijalankan dengan Bun
database/
  migrations/          # SQL migration berurutan
    meta/              # journal dan snapshot Drizzle Kit
  roles/               # grant role runtime read-only, tanpa kredensial
  seeds/               # data referensi minimal untuk development/test
.github/workflows/     # CI, preview checks, dan production deployment
bun.lock               # lockfile tunggal; wajib di-commit
bunfig.toml            # konfigurasi Bun/test tingkat repository
.oxfmtrc.json           # satu sumber aturan format Oxfmt
.oxlintrc.json          # satu sumber aturan lint Oxlint
.editorconfig           # baseline editor lintas OS
package.json           # root scripts dan deklarasi workspaces
```

Root `package.json` menggunakan `private: true` dan workspaces `apps/*` serta `packages/*`. Dependency aplikasi diletakkan pada workspace pemiliknya; root hanya memuat tooling yang benar-benar lintas workspace. Import internal memakai nama package seperti `@jaga-daerah/contracts`, bukan relative path menembus workspace.

### 15.2 Tanggung Jawab Lapisan Backend

- **Route/controller:** memakai instance/plugin Elysia untuk memvalidasi param/query, memanggil service, dan membentuk HTTP response.
- **Service:** menghitung persentase, kategori, pembanding, serta narasi. Tidak mengetahui detail HTTP maupun driver database.
- **Repository:** menjalankan query Drizzle yang bertipe dan terparameterisasi. Tidak menyusun narasi, tidak mengembalikan objek driver mentah, dan tidak memberi service akses langsung ke client database.
- **Drizzle schema:** mendefinisikan tabel, relasi, enum, indeks, constraint, dan tipe row/insert di `apps/api/src/db/schema/`.
- **Contract/schema:** mendefinisikan request, response, dan error publik. Tipe diturunkan dari Zod.
- **Middleware:** request ID, CORS allowlist, logging, cache header, dan pemetaan error tak terduga.

### 15.3 Alur Request Profil Daerah

1. Browser meminta `/daerah/kota-bandung` dari Pages dan menerima HTML serta skeleton informasi utama.
2. Island interaktif meminta `GET /v1/daerah/kota-bandung?year=2024` ke Worker.
3. Worker memvalidasi slug/tahun, lalu repository melakukan query Drizzle terparameterisasi melalui `pg` dan Hyperdrive.
4. Service menghitung metrik turunan dan menghasilkan narasi dari template deterministik.
5. Worker mengembalikan JSON, `ETag`, `Cache-Control`, dan `X-Request-Id`.
6. Frontend menampilkan data; jika modul bencana kosong, modul anggaran tetap dapat digunakan.

### 15.4 Environment

| Environment | Frontend           | API            | Database             | Tujuan                     |
| ----------- | ------------------ | -------------- | -------------------- | -------------------------- |
| Local       | `localhost` Astro  | Wrangler dev   | PostgreSQL lokal/dev | Pengembangan dan unit test |
| Preview     | Pages preview URL  | Worker staging | Database staging     | QA tiap pull request       |
| Production  | Domain utama Pages | Subdomain API  | Database production  | Demo dan akses publik      |

Data production tidak boleh digunakan pada test otomatis yang melakukan write. Binding Hyperdrive, ID resource, dan origin API dibedakan per environment.

## 16. Kontrak API

Base URL production: `https://api.jagadaerah.id/v1`. Seluruh endpoint publik bersifat `GET`, menghasilkan JSON UTF-8, dan tidak memerlukan login. Domain ini masih contoh sampai kepemilikan dan ketersediaannya diverifikasi.

| Method | Path                      | Parameter                            | Fungsi                                                           | Cache publik |
| ------ | ------------------------- | ------------------------------------ | ---------------------------------------------------------------- | ------------ |
| GET    | `/provinsi`               | `year?`                              | Daftar provinsi dan status ketersediaan data                     | 24 jam       |
| GET    | `/provinsi/:kode/daerah`  | `year?`, `cursor?`, `limit?`         | Daftar kabupaten/kota di provinsi                                | 24 jam       |
| GET    | `/daerah/search`          | `q` wajib (min. 2), `limit` maks. 10 | Autocomplete nama daerah                                         | 1 jam        |
| GET    | `/daerah/:slug`           | `year?`                              | Profil lengkap daerah; default tahun terbaru yang tersedia       | 1 jam        |
| GET    | `/daerah/:slug/ringkasan` | `year?`                              | Ringkasan teks untuk preview/share                               | 1 jam        |
| GET    | `/peta/realisasi`         | `year?`                              | Persentase realisasi per kabupaten/kota untuk peta               | 1 jam        |
| GET    | `/daerah/:slug/terkini`   | `kecamatan?`                         | Cuaca, peringatan dini, gempa BMKG, titik panas FIRMS (ADR 0004) | 2 menit      |
| GET    | `/meta/status`            | —                                    | Versi dataset aktif, pembaruan, cakupan                          | 5 menit      |
| GET    | `/health`                 | —                                    | Status proses Worker tanpa query data berat                      | tanpa cache  |

### 16.1 Envelope Response

Response sukses:

```json
{
  "data": {},
  "meta": {
    "request_id": "01J...",
    "dataset_version": "2024.1",
    "generated_at": "2026-10-17T10:00:00Z"
  }
}
```

Response gagal:

```json
{
  "error": {
    "code": "DAERAH_NOT_FOUND",
    "message": "Daerah tidak ditemukan.",
    "details": null,
    "request_id": "01J..."
  }
}
```

Kode error minimum: `INVALID_QUERY` (400), `NOT_FOUND` (404, route tidak dikenal), `PROVINSI_NOT_FOUND` (404), `DAERAH_NOT_FOUND` (404), `YEAR_NOT_AVAILABLE` (404), `RATE_LIMITED` (429), dan `INTERNAL_ERROR` (500). Daftar otoritatif ada di `packages/contracts` (`ERROR_CODES`). Pesan publik tidak memuat SQL, stack trace, atau kredensial.

### 16.2 Aturan API

- Query selalu terparameterisasi; input tidak digabung langsung ke string SQL.
- `limit` memiliki batas server-side dan pencarian mengembalikan maksimal 10 hasil.
- CORS production hanya mengizinkan domain Pages dan domain kustom resmi.
- Perubahan kontrak yang memutus kompatibilitas dibuat di versi baru, misalnya `/v2`.
- Semua response profil menyertakan level wilayah, tahun, sumber, dan status kelengkapan data.
- `404` berarti resource/tahun tidak tersedia; data numerik kosong tidak diubah menjadi nol.

## 17. Rancangan Database PostgreSQL

Drizzle ORM adalah satu-satunya data-access layer aplikasi. Schema TypeScript Drizzle menjadi definisi schema pada level aplikasi; SQL migration hasil Drizzle Kit yang sudah direview menjadi artefak perubahan database pada setiap environment.

### 17.1 Tabel Inti

| Tabel              | Kolom penting                                                                                                             | Fungsi                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `provinces`        | `id`, `code`, `name`, `slug`                                                                                              | Referensi provinsi                     |
| `regions`          | `id`, `province_id`, `code`, `name`, `slug`, `type`, `is_active`                                                          | Referensi kabupaten/kota               |
| `dataset_versions` | `id`, `version`, `status`, `published_at`, `etl_started_at`, `etl_finished_at`                                            | Versi import dan penanda versi aktif   |
| `data_sources`     | `id`, `dataset_version_id`, `publisher`, `title`, `source_url`, `period`, `downloaded_at`, `checksum_sha256`              | Provenance file sumber                 |
| `budget_facts`     | `region_id`, `dataset_version_id`, `year`, `budget_amount`, `realization_amount`, `source_id`                             | Fakta APBD per daerah/tahun            |
| `disaster_facts`   | `province_id`, `dataset_version_id`, `year`, `disaster_type`, `event_count`, `deaths`, `missing`, `affected`, `source_id` | Fakta bencana per provinsi/jenis/tahun |
| `etl_runs`         | `id`, `dataset_version_id`, `status`, `rows_read`, `rows_loaded`, `rows_rejected`, `report`                               | Audit hasil ETL                        |

### 17.2 Constraint dan Indeks Minimum

- `regions.code`, `regions.slug`, `provinces.code`, dan `provinces.slug` unik.
- `budget_facts` unik pada `(region_id, year, dataset_version_id)`.
- `disaster_facts` unik pada `(province_id, year, disaster_type, dataset_version_id)`.
- Nilai uang dan jumlah korban memiliki check constraint `>= 0` jika tidak null.
- Indeks pencarian pada nama daerah menggunakan normalisasi huruf kecil; trigram bersifat opsional setelah kebutuhan performa terbukti.
- Indeks komposit mengikuti pola query profil: `(region_id, year, dataset_version_id)` dan `(province_id, year, dataset_version_id)`.
- Hanya satu versi berstatus aktif. Aktivasi dilakukan dalam transaksi.

### 17.3 Presisi dan Nullability

- Rupiah disimpan sebagai `numeric(20,2)`, bukan floating point: DJPK menerbitkan realisasi berdesimal, jadi nilai disimpan persis seperti sumber (keputusan pemilik, Milestone 5). Ekspor DJPK untuk nilai sangat besar memakai notasi ilmiah 14 digit; baris seperti itu ditandai di laporan ETL.
- Jumlah kejadian/korban menggunakan `integer` atau `bigint` sesuai data sumber.
- `NULL` berarti sumber tidak menyediakan nilai; `0` berarti sumber secara eksplisit melaporkan nol.
- Angka LHKPN mengikuti aturan yang sama: disimpan sebagai `numeric(20,2)` dan dibaca sebagai string desimal, dengan total harta dan total utang sebagai kolom terpisah yang keduanya wajib ada sebelum ditampilkan.
- Persentase realisasi dihitung saat query/service dari nilai uang agar tidak terjadi inkonsistensi.

### 17.4 Standar Drizzle

- Client dibuat dengan `drizzle-orm/node-postgres` menggunakan connection string dari binding Hyperdrive pada Worker.
- Package `pg` adalah driver bawah, bukan API query yang dipakai langsung oleh service/repository.
- Table definitions dipisahkan per domain dan diekspor melalui satu entrypoint schema agar konfigurasi Drizzle Kit deterministik.
- Gunakan inference Drizzle (`$inferSelect`/`$inferInsert`) untuk tipe persistence internal; DTO publik tetap berasal dari Zod contracts agar bentuk database tidak bocor ke API.
- Repository memilih kolom secara eksplisit untuk response publik dan tidak memakai `select *` secara tidak sengaja.
- Raw SQL hanya diperbolehkan melalui tagged template `sql` Drizzle yang terparameterisasi ketika query builder tidak cukup jelas atau tidak mendukung fitur PostgreSQL yang diperlukan. Alasan dan test wajib disertakan.
- Jangan membuat singleton connection pool Node tradisional di luar pola yang didukung Hyperdrive/Worker. Factory client menerima connection string binding untuk setiap request/execution context sesuai panduan runtime.

## 18. Keamanan dan Privasi

- Aplikasi tidak mengumpulkan akun, NIK, alamat, atau data pribadi pengguna.
- Secret database hanya disimpan sebagai konfigurasi Hyperdrive/secret Worker, tidak di source code atau variable frontend.
- Gunakan user PostgreSQL khusus aplikasi dengan hak `SELECT` saja; user ETL terpisah memiliki hak tulis terbatas pada tabel yang diperlukan.
- TLS digunakan di seluruh koneksi publik. Header minimum: CSP, `X-Content-Type-Options`, `Referrer-Policy`, dan `Permissions-Policy`.
- Dependency scanning dan secret scanning dijalankan di CI bila tersedia.
- Log tidak menyimpan connection string, isi query sensitif, atau IP penuh lebih lama dari kebutuhan operasional.
- Endpoint hanya read-only; operasi publish dataset tidak diekspos sebagai API publik.

## 19. Non-Functional Requirements

| Aspek             | Target                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Performa frontend | LCP ≤ 2,5 detik; CLS ≤ 0,1; JavaScript awal diminimalkan                                            |
| Performa API      | p95 ≤ 500 ms untuk response cache-hit dan target ≤ 1.500 ms untuk cache-miss pada kondisi demo      |
| Availability      | 99,5% selama periode penjurian, di luar gangguan penyedia                                           |
| Aksesibilitas     | WCAG 2.1 AA untuk kontras, fokus, label form, keyboard, dan alternatif grafik                       |
| Responsif         | Mendukung lebar 320 px hingga desktop modern                                                        |
| SEO/share         | Title, description, canonical, Open Graph, sitemap, dan `robots.txt`                                |
| Kompatibilitas    | Dua versi terbaru Chrome, Edge, Firefox, dan Safari                                                 |
| Observability     | Error, latency, status code, dan request ID dapat ditelusuri                                        |
| Pemulihan         | Database memiliki backup terjadwal dari provider; versi dataset sebelumnya dapat diaktifkan kembali |

## 20. Strategi Cache

- Aset Pages memakai cache CDN bawaan dengan nama file ber-hash.
- API mengirim `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` untuk profil; TTL dapat disesuaikan per endpoint sesuai tabel bagian 16.
- Cache key memasukkan path, parameter `year`, dan versi API; parameter tak dikenal ditolak atau diabaikan secara konsisten.
- Aktivasi dataset baru diikuti purge cache API atau perubahan cache key berbasis `dataset_version`.
- Endpoint health dan response error 5xx tidak disimpan di cache publik.
- Cache hanya optimasi; PostgreSQL tetap sumber kebenaran.

## 21. Deployment dan CI/CD

### 21.1 Frontend — Cloudflare Pages

- Production branch: `main`; pull request mendapat preview deployment.
- Build command: `bun run --filter @jaga-daerah/web build`; output directory: `apps/web/dist`.
- `PUBLIC_API_BASE_URL` berbeda antara preview dan production.
- Untuk First Draft, halaman konten diprerender agar cepat; data interaktif dimuat dari API.

### 21.2 Backend — Cloudflare Workers

- Deploy menggunakan Wrangler dari pipeline setelah lint, typecheck, dan test lolos.
- Konfigurasi memuat compatibility date, route/domain, binding Hyperdrive, dan observability.
- Deployment staging dilakukan sebelum production; migrasi database dijalankan sebelum Worker yang membutuhkan skema baru.
- Rollback aplikasi memakai deployment/version Worker sebelumnya; rollback data memakai `dataset_version` sebelumnya.

### 21.3 Quality Gate Pipeline

1. Install dependency dengan `bun install --frozen-lockfile` dari `bun.lock`.
2. Lint dan format check hanya pada source yang relevan.
3. Typecheck frontend, API, dan contracts.
4. Unit test service dan schema.
5. Integration test Drizzle repository dan migration terhadap PostgreSQL test.
6. Build Astro dan Worker.
7. Deploy preview/staging; jalankan smoke test `/health`, pencarian, dan satu profil contoh.
8. Production deploy dilakukan setelah review.

## 22. Strategi Pengujian

| Jenis test       | Contoh kasus wajib                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Unit             | Persentase normal, anggaran nol, realisasi null, pembulatan, klasifikasi status, template narasi      |
| Contract         | Response API sesuai schema Zod; error memiliki envelope konsisten                                     |
| Repository       | Query Drizzle untuk slug/tahun, versi aktif, parameter binding, dan region tanpa data bencana         |
| ETL              | Kode wilayah invalid, duplikasi, angka berformat Indonesia, kolom sumber berubah, rollback saat gagal |
| Component        | Search keyboard, loading, empty state, error state, format rupiah                                     |
| End-to-end       | Home → cari “Bandung” → buka profil → lihat sumber; modul kosong tidak merusak halaman                |
| Accessibility    | Tab order, visible focus, label form, heading hierarchy, grafik dapat dipahami tanpa warna            |
| Smoke production | `/health`, `/meta/status`, tiga daerah contoh, asset utama, CORS                                      |

## 23. Acceptance Criteria First Draft

- Landing page, pencarian, dan minimal satu profil daerah dapat diakses melalui URL Cloudflare Pages.
- Pencarian memakai Worker API dan mengembalikan hasil PostgreSQL, bukan data hard-coded di frontend.
- Worker terhubung ke PostgreSQL melalui Hyperdrive pada environment production/staging.
- Profil menampilkan anggaran, realisasi, persentase, ringkasan deterministik, data bencana berlabel tingkat provinsi, dan sumber.
- Loading, not found, API error, dan partial-data state memiliki tampilan yang dapat dipahami.
- Pengguna dapat menyelesaikan alur utama hanya dengan keyboard.
- Unit test perhitungan utama dan smoke test endpoint lulus.
- Tidak ada secret di repository atau bundle browser.
- README mendokumentasikan setup lokal, env yang diperlukan, migrasi, ETL, test, dan deployment.

## 24. Keputusan Terbuka Sebelum Implementasi

- Pilih provider PostgreSQL terkelola yang dapat diakses Hyperdrive, lokasi region yang dekat dengan mayoritas pengguna/data, kebijakan backup, dan batas biaya.
- Konfirmasi tahun data yang akan menjadi default serta apakah APBD memakai anggaran awal atau anggaran setelah perubahan.
- Validasi lisensi dan stabilitas `almach/ui`; bila tidak memadai, gunakan komponen lokal sederhana tanpa menambah design system kedua.
- ~~Tentukan ambang label “realisasi tinggi/rendah”~~ Diputuskan (Milestone 6): label menyatakan posisi terhadap median nasional kabupaten/kota pada tahun yang sama (di atas / di bawah / sama dengan), bukan “tinggi/rendah”.
- Putuskan domain final dan apakah API memakai subdomain terpisah untuk konfigurasi CORS yang jelas.

## 25. Referensi Teknis Cloudflare

- Cloudflare Pages mendukung deployment Astro dan preview deployment dari repository Git: https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/
- Cloudflare Workers memakai runtime berbasis Web Platform APIs: https://developers.cloudflare.com/workers/runtime-apis/
- Hyperdrive menghubungkan Workers ke PostgreSQL dengan connection pooling: https://developers.cloudflare.com/hyperdrive/get-started/
- Driver `pg` direkomendasikan Cloudflare untuk JavaScript/TypeScript Workers yang memakai Hyperdrive: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
- Drizzle ORM didukung untuk PostgreSQL melalui Cloudflare Hyperdrive: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/drizzle-orm/
- Drizzle Kit menghasilkan dan menerapkan migration SQL yang tercatat: https://orm.drizzle.team/docs/drizzle-kit-migrate

## 26. Standar Bun Workspaces dan Tooling

### 26.1 Konfigurasi Root

Contoh minimum root `package.json`:

```json
{
  "name": "jaga-daerah",
  "private": true,
  "packageManager": "bun@<pinned-version>",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun run --parallel --filter './apps/*' dev",
    "build": "bun run --filter '*' build",
    "check": "bun run format:check && bun run lint && bun run typecheck && bun run test",
    "clean": "bun run tools/clean.ts",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "lint": "oxlint . --report-unused-disable-directives",
    "typecheck": "bun run --filter '*' typecheck",
    "test": "bun test --check",
    "test:coverage": "bun test --check --coverage"
  },
  "devDependencies": {
    "@astrojs/compiler-rs": "<pinned-version>",
    "oxfmt": "<pinned-version>",
    "oxlint": "<pinned-version>"
  }
}
```

`<pinned-version>` diganti dengan versi Bun/Oxc yang benar-benar dipakai tim dan diperbarui secara sadar. CI dan developer menggunakan versi yang sama. Jika opsi CLI berubah pada versi yang dipilih, script diverifikasi lebih dahulu dan dicatat di README. Tool diinstal lokal di root workspace; command selalu dijalankan melalui `bun run`, bukan mengandalkan instalasi global.

### 26.2 Aturan Dependency

- Gunakan `bun add <package> --filter <workspace>` agar dependency tercatat pada pemilik yang benar.
- Commit `bun.lock`; CI wajib memakai `bun install --frozen-lockfile`.
- Dilarang mencampur `package-lock.json`, `pnpm-lock.yaml`, atau `yarn.lock`.
- Pin major version dan review changelog sebelum upgrade framework, driver database, Wrangler, atau adapter Cloudflare.
- Dependency baru harus menjawab kebutuhan nyata, aktif dipelihara, kompatibel dengan Workers, dan tidak menduplikasi fungsi yang sudah tersedia.
- Jalankan audit dependency pada CI/release; temuan severity tinggi/kritis yang relevan memblokir deployment sampai ditangani atau didokumentasikan sebagai accepted risk.
- Jangan menjalankan postinstall script dari package yang tidak dipercaya tanpa review.

### 26.3 Oxfmt sebagai Formatter Tunggal

- Gunakan Oxfmt untuk TypeScript, JavaScript, JSX/TSX, Astro, JSON, CSS, dan Markdown yang didukung oleh versi terpilih.
- Dukungan `.astro` diaktifkan melalui opsi `astro` dan dependency `@astrojs/compiler-rs`; keduanya diverifikasi dalam `format:check` CI.
- Repository hanya memiliki satu root `.oxfmtrc.json`; nested config dilarang kecuali ada alasan framework yang terdokumentasi.
- Baseline: `printWidth: 100`, `tabWidth: 2`, spaces, semicolon aktif, trailing comma multiline, final newline, dan line ending LF.
- Import sorting dan Tailwind class sorting hanya diaktifkan setelah diverifikasi aman untuk Astro/React pada versi Oxfmt yang dipin.
- Generated files, coverage, output build, migration snapshot, dan data mentah ETL dimasukkan ke `ignorePatterns`; file sumber aplikasi tidak boleh dikecualikan hanya untuk menyembunyikan masalah format.
- Developer menjalankan `bun run format`; CI hanya menjalankan `bun run format:check` dan tidak mengubah file.
- Tidak menggunakan Prettier atau Biome formatter bersamaan karena menghasilkan perubahan format yang saling bertentangan.

Contoh baseline `.oxfmtrc.json`:

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "insertFinalNewline": true,
  "endOfLine": "lf",
  "astro": true,
  "ignorePatterns": [
    "**/dist/**",
    "**/.astro/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "**/node_modules/**",
    "tools/etl/data/raw/**"
  ]
}
```

Opsi final harus divalidasi dengan schema dari versi Oxfmt yang dipin; opsi eksperimental tidak diaktifkan tanpa fixture dan review hasil format.

### 26.4 Oxlint sebagai Linter Tunggal

- Oxlint menjadi linter utama untuk seluruh JavaScript/TypeScript/React. Jangan menambahkan ESLint hanya karena kebiasaan; tambahkan fallback hanya bila ada rule kritis yang terbukti belum tersedia.
- Aktifkan kategori correctness dan suspicious sebagai error. Style yang sudah ditangani Oxfmt tidak diduplikasi sebagai rule lint.
- Plugin React, Unicorn, Oxc, dan TypeScript diaktifkan sesuai file/environment. Global browser hanya berlaku di web; global Worker hanya berlaku di API melalui override.
- Warning tidak dibiarkan menumpuk: target CI adalah `maxWarnings: 0`.
- Disable directive harus sempit, berada tepat di atas baris terkait, menyebut alasan, dan diperiksa dengan `--report-unused-disable-directives`.
- Autofix dijalankan secara sadar pada branch developer; CI tidak melakukan autofix.
- Type-aware Oxlint boleh diaktifkan setelah `oxlint-tsgolint` dan versi TypeScript proyek terbukti kompatibel. Sampai itu terjadi, `typecheck` framework/TypeScript tetap menjadi quality gate terpisah.
- Tidak menggunakan konfigurasi JavaScript/TypeScript eksperimental untuk linter; gunakan `.oxlintrc.json`/JSONC agar konsisten di Bun, editor, dan CI.

Baseline `.oxlintrc.json` harus berisi `ignorePatterns` untuk artefak yang sama dengan Oxfmt, `maxWarnings: 0`, plugin yang diperlukan, dan override per workspace. Daftar rule dikunci di repository dan perubahan rule diperlakukan sebagai perubahan engineering yang direview, bukan perubahan kosmetik massal.

Contoh baseline minimal:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "perf": "warn"
  },
  "plugins": ["oxc", "typescript", "unicorn", "react"],
  "options": {
    "maxWarnings": 0
  },
  "ignorePatterns": [
    "**/dist/**",
    "**/.astro/**",
    "**/.wrangler/**",
    "**/coverage/**",
    "**/node_modules/**"
  ]
}
```

Konfigurasi final dibuat dengan CLI/schema dari versi Oxlint yang dipin. Rule React hanya diterapkan pada `apps/web/**/*.{jsx,tsx}` melalui override bila plugin menimbulkan false positive pada file Worker atau script ETL.

### 26.5 Clean yang Aman dan Deterministik

- `bun run clean` menjalankan `tools/clean.ts`, bukan command shell lintas platform atau glob penghapusan yang luas.
- Script hanya boleh menghapus direktori hasil build yang sudah di-allowlist dan sudah di-resolve di dalam root repository: `apps/web/dist`, `.astro`, `.wrangler`, `coverage`, serta cache lokal proyek.
- `node_modules`, `bun.lock`, migration, source, file mentah ETL, `.env`, dan data pengguna tidak dihapus oleh clean standar.
- Sebelum penghapusan, script memverifikasi real path target masih berada di workspace root dan tidak menerima path arbitrer dari argumen pengguna.
- Sediakan `clean:build` dan `clean:test` hanya jika kebutuhan nyata muncul; jangan membuat `clean:all` destruktif.
- CI biasanya tidak perlu menjalankan clean karena checkout bersih. Clean digunakan untuk pemulihan environment lokal dan harus menghasilkan daftar target yang dihapus.

### 26.6 Scripts per Workspace

| Workspace                | Script wajib                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `@jaga-daerah/web`       | `dev`, `build`, `preview`, `typecheck`, `test`                     |
| `@jaga-daerah/api`       | `dev`, `deploy`, `typecheck`, `test`, `test:integration`           |
| `@jaga-daerah/contracts` | `build` jika perlu, `typecheck`, `test`                            |
| `@jaga-daerah/ui`        | `typecheck`, `test`; build hanya bila package menghasilkan artefak |

Script root hanya mengorkestrasi script workspace. Semua command developer memakai `bun run <script>` dan semua executable dependency berasal dari `node_modules` workspace. Jangan memasukkan koneksi production atau secret ke script `package.json`.

Typecheck tetap eksplisit: workspace web menjalankan `astro check`, sedangkan API, contracts, dan UI menjalankan `tsc --noEmit` dengan `tsconfig` masing-masing. Oxlint melengkapi pemeriksaan tersebut dan tidak diam-diam menggantikannya.

## 27. Standar TypeScript dan Kualitas Kode

### 27.1 TypeScript Baseline

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noImplicitOverride: true`, dan `useUnknownInCatchVariables: true`.
- Target dan library mengikuti environment: Web APIs/DOM untuk frontend, tipe Cloudflare Workers untuk API.
- Hindari `any`; gunakan `unknown` di boundary lalu validasi dengan Zod.
- Jangan memakai non-null assertion (`!`) untuk menutupi state yang belum divalidasi.
- Gunakan `import type` untuk import yang hanya berupa tipe.
- Kontrak publik berasal dari schema; jangan menulis interface response kedua secara manual.
- Nominal ID/kode wilayah tetap string agar nol di depan tidak hilang.
- Nilai rupiah dari PostgreSQL diperlakukan sebagai string desimal/`bigint` yang aman, bukan dipaksa ke JavaScript `number` jika dapat melampaui batas integer aman.

### 27.2 Naming dan Struktur File

| Elemen            | Aturan                                     | Contoh                                  |
| ----------------- | ------------------------------------------ | --------------------------------------- |
| File komponen     | PascalCase                                 | `RegionSearch.tsx`                      |
| File util/service | kebab-case                                 | `format-rupiah.ts`, `region-service.ts` |
| Fungsi/variabel   | camelCase, nama berbasis maksud            | `getRegionProfile`                      |
| Tipe/schema       | PascalCase; schema berakhiran `Schema`     | `RegionProfileSchema`                   |
| Konstanta global  | SCREAMING_SNAKE_CASE                       | `MAX_SEARCH_RESULTS`                    |
| Route             | kata benda Bahasa Indonesia yang konsisten | `/daerah/:slug`                         |
| Database          | snake_case                                 | `dataset_versions`                      |

- Satu file memiliki satu tanggung jawab utama; pecah file berdasarkan perubahan yang independen, bukan sekadar jumlah baris.
- Gunakan named export untuk modul aplikasi. Default export hanya jika diwajibkan Astro/Cloudflare atau konvensi framework.
- Komentar menjelaskan alasan dan constraint, bukan mengulang kode.
- Tidak ada dead code, commented-out code, `console.log` sementara, atau TODO tanpa issue/konteks sebelum merge.

### 27.3 Function dan Error Standards

- Fungsi service harus deterministik bila memungkinkan, menerima dependency sebagai parameter, dan mudah diuji.
- Return lebih awal untuk invalid state; batasi nesting.
- Jangan menangkap error hanya untuk mengabaikannya. Error internal dilog satu kali di boundary dengan request ID.
- Gunakan class/discriminated union error aplikasi yang kecil: validation, not found, unavailable, dan internal.
- Pesan pengguna menggunakan Bahasa Indonesia yang jelas; detail teknis hanya di log internal.
- Semua operasi I/O memiliki timeout atau batas eksekusi yang masuk akal.
- Retry hanya untuk kegagalan sementara dan operasi idempotent, dengan backoff serta jumlah percobaan terbatas.

### 27.4 Pull Request Standard

- Satu PR berfokus pada satu perubahan yang dapat dijelaskan dan diuji.
- PR menyertakan tujuan, perubahan perilaku, screenshot untuk UI, cara menguji, migrasi/risiko, dan rollback plan bila relevan.
- Minimal satu reviewer memeriksa kontrak API, aksesibilitas UI, query database, dan dampak keamanan sesuai area perubahan.
- Merge diblokir jika format, lint, typecheck, test, build, atau migration check gagal.

## 28. Sistem Desain Responsif

### 28.1 Prinsip Layout

- Mobile-first; konten inti dapat dibaca mulai lebar 320 px tanpa horizontal scroll.
- Container utama maksimum sekitar 1200 px, memakai padding responsif dan ukuran teks yang nyaman dibaca.
- Gunakan CSS Grid untuk layout halaman dan Flexbox untuk kelompok kontrol satu dimensi.
- Breakpoint didasarkan pada kebutuhan konten, bukan model perangkat tertentu. Baseline: mobile `<640`, tablet `640–1023`, desktop `≥1024` px.
- Card tidak mempunyai tinggi paksa jika kontennya dinamis. Angka panjang harus wrap atau menggunakan ukuran responsif tanpa terpotong.
- Touch target minimal 44×44 px; jarak antarkontrol mencegah salah sentuh.

### 28.2 Perilaku per Ukuran Layar

| Area          | Mobile                                              | Tablet                           | Desktop                                    |
| ------------- | --------------------------------------------------- | -------------------------------- | ------------------------------------------ |
| Header        | Logo + menu ringkas                                 | Navigasi ringkas                 | Navigasi penuh                             |
| Hero          | Satu kolom; search selebar container                | Satu kolom lebar terbatas        | Dua kolom bila mendukung hierarki          |
| Statistik     | Satu/dua kolom                                      | Tiga kolom                       | Tiga kolom                                 |
| Profil daerah | Semua modul bertumpuk                               | Grid 2 kolom untuk angka ringkas | Grid 12 kolom; konten utama + panel sumber |
| Grafik        | Tinggi 240–280 px; label dipersingkat               | Tinggi 300 px                    | Tinggi 320–360 px                          |
| Tabel         | Diubah menjadi cards atau scroll container berlabel | Scroll bila perlu                | Tabel penuh                                |
| Filter        | Tombol membuka sheet/dialog                         | Bar horizontal wrap              | Bar horizontal                             |

### 28.3 Typography, Color, dan Motion

- Gunakan skala tipografi konsisten dan `clamp()` untuk judul besar; body minimum 16 px pada mobile.
- Kontras teks memenuhi WCAG AA. Status tidak disampaikan lewat warna saja.
- Gunakan tabular numerals untuk angka finansial agar mudah dibandingkan.
- Animasi hanya membantu orientasi: 150–250 ms, transform/opacity, tanpa menghambat input.
- Hormati `prefers-reduced-motion`; nonaktifkan transisi dekoratif dan smooth scrolling bila pengguna meminta pengurangan gerak.
- Dark mode bukan scope First Draft kecuali desain dan seluruh grafik dapat diuji lengkap; jangan membuat versi setengah jadi.

### 28.4 Responsive QA Matrix

UI diperiksa setidaknya pada viewport 320×568, 375×667, 390×844, 768×1024, 1024×768, 1280×800, dan 1440×900, serta zoom browser 200%. Pengujian mencakup nama daerah panjang, angka triliunan, teks error panjang, data kosong, dan hasil search maksimum.

## 29. Spesifikasi Interaksi

### 29.1 Autocomplete Pencarian Daerah

- Input memakai combobox yang mengikuti pola ARIA: `role=combobox`, listbox, option, `aria-expanded`, `aria-controls`, dan active descendant.
- Request dimulai setelah minimal 2 karakter, debounce 250–300 ms, dan request lama dibatalkan dengan `AbortController`.
- Navigasi: panah atas/bawah memilih, Enter membuka, Escape menutup, Tab melanjutkan fokus secara wajar.
- Search menampilkan state `idle`, `typing`, `loading`, `success`, `empty`, `error`, dan `offline`.
- Highlight kecocokan tidak mengubah accessible name. Maksimal 10 hasil dan urutan mengutamakan exact/prefix match.
- Riwayat pencarian tidak disimpan tanpa persetujuan; query URL boleh dipakai agar hasil dapat dibagikan.

### 29.2 Dropdown Provinsi dan Daerah

- Pilihan daerah nonaktif sampai provinsi dipilih.
- Mengganti provinsi mereset pilihan daerah secara eksplisit.
- Status loading diumumkan melalui live region yang tidak mengganggu.
- Validasi tidak hanya mengandalkan client; API tetap memvalidasi kode wilayah.
- URL hasil memakai slug canonical dan dapat dibuka langsung/reload.

### 29.3 Grafik Interaktif

- Tooltip dapat diakses dengan pointer maupun keyboard.
- Setiap grafik mempunyai judul, deskripsi singkat, unit, periode, legenda, serta tabel/teks alternatif.
- Jangan memuat library grafik sebelum grafik mendekati viewport bila lazy loading tidak mengurangi aksesibilitas.
- Resize observer memperbarui ukuran tanpa layout shift; tinggi minimum disediakan sebelum hydrate.
- Grafik tetap memberikan informasi inti jika JavaScript gagal, melalui ringkasan HTML atau daftar data.

### 29.4 Feedback dan Navigasi

- Skeleton menyerupai layout akhir dan tidak bergerak; gunakan spinner hanya untuk aksi singkat dengan label.
- Toast hanya untuk informasi sementara; error yang membutuhkan tindakan tampil dekat kontrol terkait.
- Perubahan route memindahkan fokus ke heading halaman dan judul dokumen diperbarui.
- Tombol/link memiliki label berbasis tindakan. Elemen yang menuju halaman memakai link, bukan button.
- Tidak ada infinite scroll untuk daftar daerah; gunakan pagination atau filter yang dapat diprediksi.

## 30. Progressive Enhancement dan Ketahanan UI

- HTML awal memuat heading, deskripsi produk, daerah contoh, sumber, dan struktur halaman yang bermakna.
- JavaScript menambah autocomplete, tooltip, dan grafik; informasi kritis tidak eksklusif berada di canvas/client state.
- Error boundary memisahkan kegagalan search/grafik dari halaman keseluruhan.
- API timeout menghasilkan pesan retry yang jelas dan tidak menghapus data yang sudah berhasil tampil.
- Saat offline, halaman statis yang sudah tersimpan tetap informatif; aplikasi tidak mengklaim data terbaru tanpa konfirmasi API.
- Hindari service worker pada First Draft kecuali kebutuhan offline sudah jelas, karena cache ganda dapat menyajikan data lama.
- Third-party script analitik dimuat setelah konten utama dan tidak memblokir rendering. Hindari tracker bila metrik bawaan Cloudflare sudah cukup.

## 31. Security Engineering Checklist

### 31.1 Browser dan HTTP

- CSP dimulai ketat: `default-src 'self'`; domain API, font, gambar, dan script ditambahkan secara eksplisit. Hindari `'unsafe-eval'`; penggunaan `'unsafe-inline'` harus dieliminasi atau memakai nonce/hash.
- Header minimum: HSTS setelah domain stabil, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, dan `frame-ancestors 'none'` melalui CSP.
- CORS memakai allowlist exact origin. Jangan merefleksikan arbitrary `Origin` dan jangan menggunakan credentials karena API publik tidak memerlukan cookie.
- Semua link eksternal yang membuka tab baru memakai `rel="noopener noreferrer"`.
- Konten dinamis dirender sebagai teks; jangan memakai `innerHTML`/`set:html` untuk data sumber tanpa sanitasi yang teruji.

### 31.2 API dan Abuse Protection

- Validasi panjang dan karakter `q`, `slug`, `kode`, `year`, `limit`, dan cursor sebelum query.
- Batas awal: query search 2–80 karakter, slug maksimal 120, `limit` 1–10, dan tahun dalam rentang dataset yang tersedia.
- Rate limit diterapkan per endpoint berbiaya tinggi; response 429 menyertakan `Retry-After` bila memungkinkan.
- Cache key tidak menerima header/query arbitrer. Error response, request dengan auth, dan response personal tidak di-cache.
- Gunakan Drizzle query builder atau tagged template `sql` yang terparameterisasi saja. Identifier tabel/kolom tidak berasal dari input pengguna.
- Response size dibatasi; pagination wajib untuk daftar yang berpotensi besar.
- Health endpoint tidak membuka versi dependency, connection string, detail database, atau stack trace.

### 31.3 Database dan ETL

- Role runtime hanya `CONNECT` dan `SELECT` pada schema publik yang diperlukan. Role migrasi dan ETL terpisah.
- Batasi koneksi, statement timeout, idle timeout, dan query duration; hindari transaksi panjang dari Worker.
- Migrasi bersifat forward-compatible: tambah kolom nullable/default aman sebelum kode menggunakannya; destructive migration dipisah setelah rollout.
- File XLSX diperlakukan sebagai input tidak dipercaya: batas ukuran, validasi MIME/ekstensi, nama file dinormalisasi, formula tidak pernah dieksekusi, dan parsing dilakukan di environment terisolasi.
- Simpan checksum serta provenance; jangan mengganti file mentah lama dengan file baru bernama sama.
- Backup database dienkripsi dan restore drill diuji sebelum final submission.

### 31.4 Secret dan Supply Chain

- `.env`, credential JSON, dump database, dan token tidak boleh di-commit; sediakan `.env.example` hanya berisi nama variable dan nilai palsu.
- Secret production dikelola Cloudflare secrets/provider database dan dirotasi jika pernah terekspos.
- Workflow CI pihak ketiga dipin ke release tepercaya; permission GitHub Actions menggunakan least privilege.
- Deployment production memakai environment protection dan tidak berjalan dari pull request fork yang tidak dipercaya.
- Log dan artefak CI diperiksa agar tidak mencetak secret.

## 32. Database Migration dan Release Safety

- Ubah Drizzle schema lebih dahulu, lalu hasilkan migration SQL dan metadata dengan Drizzle Kit.
- Setiap perubahan schema menghasilkan migration baru dan tidak diedit setelah diterapkan di shared environment.
- Jalankan `drizzle-kit check` melalui script Bun sebelum migration diterapkan.
- `drizzle-kit push` hanya boleh digunakan pada database lokal disposable; dilarang untuk staging dan production karena melewati alur migration yang direview.
- Migration memiliki precondition, transaksi bila PostgreSQL mendukung operasi tersebut, verification query, dan rollback/roll-forward plan.
- Jalankan migration pada staging dengan salinan bentuk data representatif sebelum production.
- Urutan release: migration backward-compatible → deploy Worker → smoke test → publish dataset → deploy frontend bila kontrak UI berubah.
- Jangan menjalankan ETL dan migration schema besar bersamaan.
- Untuk index besar gunakan strategi yang meminimalkan lock; jadwalkan di luar demo/penjurian.
- Catat aplikasi, schema, dan dataset version secara terpisah agar diagnosis dan rollback jelas.

## 33. Observability dan Incident Response

### 33.1 Log Terstruktur

Field minimum: `timestamp`, `level`, `service`, `environment`, `request_id`, `route`, `method`, `status`, `duration_ms`, `cache_status`, `dataset_version`, dan `error_code`. Query pencarian mentah dan IP lengkap tidak perlu dicatat secara permanen.

### 33.2 Metrics dan Alert

- Pantau request count, error rate 4xx/5xx, latency p50/p95/p99, cache hit ratio, timeout database, dan connection error.
- Alert prioritas tinggi bila `/health` gagal berturut-turut, 5xx melonjak, atau database tidak dapat diakses.
- ETL melaporkan jumlah baris dibaca/dimuat/ditolak, durasi, checksum, dan hasil quality gate.
- Synthetic smoke test memeriksa home, search, satu profil lengkap, dan satu partial-data profile.

### 33.3 Respons Insiden Ringkas

1. Konfirmasi dampak melalui request ID dan metrics.
2. Bekukan publish dataset/deployment baru.
3. Rollback Worker atau aktifkan dataset version terakhir yang sehat.
4. Tampilkan pesan layanan terganggu tanpa membuat klaim data yang salah.
5. Dokumentasikan akar masalah, timeline, dampak, dan pencegahan setelah layanan pulih.

## 34. Testing Matrix yang Diperluas

- **Unit:** Bun test untuk formatter, parser, perhitungan, template narasi, validasi, dan service tanpa I/O.
- **Component:** interaksi combobox, keyboard, focus, loading/error/empty, grafik fallback, dan responsive props.
- **Worker integration:** jalankan pada runtime simulasi Cloudflare yang sesuai untuk memeriksa binding, middleware, cache header, CORS, dan error mapping; jangan menganggap test Bun murni identik dengan Workers.
- **Database integration:** PostgreSQL sementara dengan migration Drizzle asli, seed kecil, role read-only, constraint, query plan, dan rollback transaksi.
- **Contract:** frontend fixture dan API response divalidasi terhadap schema package `contracts` yang sama.
- **E2E:** browser nyata pada preview deployment untuk alur mouse, keyboard, mobile viewport, direct URL, refresh, offline/error, dan back/forward.
- **Visual regression:** halaman utama/profil pada viewport utama, hanya untuk komponen stabil agar snapshot tidak menjadi noise.
- **Security:** dependency audit, secret scan, header/CSP check, CORS negative test, injection payload, oversized query, rate limit, dan access-role test.
- **Performance:** Lighthouse/Web Vitals frontend dan load test ringan endpoint read-only tanpa membebani sumber resmi.

Coverage bukan satu-satunya ukuran kualitas. Target awal: 80% branch untuk `contracts` dan service bisnis; route adapter/UI dekoratif diuji berdasarkan risiko serta perilaku pengguna.

## 35. Definition of Done

Sebuah fitur dianggap selesai hanya jika:

- Perilaku dan acceptance criteria terpenuhi pada mobile dan desktop.
- Loading, empty, partial, offline, forbidden bila relevan, not-found, dan unexpected-error state dipertimbangkan.
- Semantic HTML, keyboard, focus, screen reader label, kontras, reduced motion, dan zoom 200% diperiksa.
- Input divalidasi di boundary dan output sesuai kontrak.
- Tidak ada secret, data pribadi, stack trace, atau SQL detail yang bocor.
- Unit/integration test relevan ditambahkan dan seluruh quality gate lulus.
- Query baru memiliki index/query-plan review bila mengakses tabel fakta.
- Dokumentasi kontrak, environment, migration, dan runbook diperbarui.
- Preview deployment ditinjau; screenshot disertakan untuk perubahan visual.
- Rollback atau degradation behavior dipahami.

## 36. Checklist Pra-Demo dan Pra-Rilis

### 36.1 H-7 sampai H-1

- Bekukan perubahan arsitektur besar; fokus pada bug, data, aksesibilitas, dan konten.
- Pastikan minimal tiga daerah contoh mencakup data lengkap, partial data, dan nama panjang.
- Jalankan ETL final, quality report, checksum, dan review manual angka utama terhadap sumber.
- Uji backup/restore atau minimal rollback dataset version.
- Jalankan full pipeline, responsive matrix, keyboard-only flow, serta smoke test production.
- Siapkan screenshot, video cadangan, dan halaman statis informatif jika API mengalami gangguan.

### 36.2 Hari Demo

- Periksa Cloudflare/DB status, `/health`, `/meta/status`, cache, domain, TLS, dan quota.
- Jangan melakukan migration, upgrade dependency, atau publish data baru tanpa kebutuhan kritis.
- Simpan request ID bila terjadi error dan gunakan rollback yang sudah diuji.
- Pastikan narasi demo menyebut tahun dan perbedaan level data APBD kabupaten/kota vs bencana provinsi.

## 37. Referensi Bun

- Dokumentasi Bun dan kemampuan package manager/workspaces: https://bun.sh/docs
- Bun test runner, TypeScript checking, coverage, dan CI: https://bun.sh/docs/test
