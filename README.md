# JagaDaerah

> Anggaran dan risiko daerah, dibuat mudah dipahami.

JagaDaerah adalah website transparansi publik: warga mengetik nama kabupaten/kotanya, lalu mendapat
satu halaman yang menjelaskan ke mana uang daerah itu dibelanjakan, berapa dana bagi hasil sumber
daya alam yang diterima daerah tersebut, siapa kepala daerah dan wakilnya yang sedang menjabat, serta
bencana apa yang tercatat di provinsinya. Semua angka berasal dari publikasi resmi, selalu disertai
tahun, tingkat wilayah, dan tautan sumbernya. Situs tidak menilai kinerja pemerintah daerah: angka
disajikan apa adanya, data yang tidak tersedia ditandai "Data belum tersedia" dan tidak pernah
diubah menjadi nol. Produk ini disusun untuk kompetisi WIA MIA 2026 (tema _Designing Digital
Futures, Powering Public Transparency_).

## Status

Berjalan secara lokal, **belum di-deploy**. Belum ada resource Cloudflare, konfigurasi Hyperdrive,
atau provider PostgreSQL yang diprovision, dan belum ada URL produksi. Lihat `PROJECT_STATUS.md` untuk
milestone aktif dan buktinya.

## Yang sudah berjalan

- **514 profil kabupaten/kota** (416 kabupaten, 98 kota) di 38 provinsi, satu halaman yang di-prerender
  per daerah dari daftar wilayah yang di-commit.
- **Pencarian daerah** dengan autocomplete di landing page, dilayani `GET /v1/daerah/search` dari
  PostgreSQL, plus tiga pintasan daerah statis yang tetap berfungsi tanpa JavaScript.
- **Peta nasional** kabupaten/kota: warna menurut persentase realisasi belanja dibanding median
  nasional, dengan tooltip, klik membuka profil, filter provinsi, legenda, dan tabel alternatif yang
  dapat dioperasikan dengan keyboard. Profil menampilkan peta provinsi dengan daerah tersebut
  disorot.
- **Anggaran (Belanja Daerah) 2024–2025** untuk 508 kabupaten/kota otonom per tahun, dari ekspor DJPK
  Kemenkeu: anggaran, realisasi, persentase realisasi, dan perbandingan terhadap median nasional tahun
  yang sama. Kabupaten/kota administrasi DKI Jakarta tidak memiliki APBD sendiri.
- **Bencana tingkat provinsi 2024–2025** dari BNPB: jumlah kejadian per jenis bencana untuk 38
  provinsi, beserta korban meninggal, hilang, dan terdampak.
- **Dana bagi hasil sumber daya alam** yang diterima kabupaten/kota, dari ekspor TKDD DJPK (minyak
  bumi, gas bumi, minerba, kehutanan, perikanan, panas bumi, dan DBH perkebunan sawit). Bagian ini
  selalu diberi keterangan bahwa angka tersebut adalah transfer yang diterima daerah, bukan ukuran
  kekayaan atau cadangan alamnya.
- **Kepala daerah dan wakilnya yang menjabat** untuk seluruh 514 kabupaten/kota, dengan gelar "Plt"
  untuk pelaksana tugas dan periode jabatannya. Setiap orang dicocokkan terhadap daftar calon resmi
  KPU Pilkada 2024 dan hasil pencocokannya dinyatakan terbuka di profil ("Cocok dengan daftar calon
  KPU", "Belum cocok dengan data KPU", atau "Diangkat, bukan lewat Pilkada" untuk kabupaten/kota
  administrasi DKI Jakarta). Profil menautkan revisi Wikipedia yang dipakai (URL `oldid`) dan
  mencantumkan kredit foto Wikimedia Commons beserta lisensinya.

## Sedang dikerjakan — belum dipublikasikan

- **Harta kekayaan pejabat (LHKPN).** Pipeline `jaga_etl.lhkpn` ada, tetapi berjalan dengan dataset
  kosong: `apps/web/src/data/lhkpn.json` masih berisi `"regions": {}`, sehingga setiap profil
  menampilkan "belum tersedia". Publikasi angka menunggu keputusan penggunaan ulang yang masih
  terbuka (`docs/decisions/0003-publish-lhkpn-figures.md`, `docs/SECURITY.md`).
- **Rincian belanja menurut jenis belanja.** Kontrak, migration `0005`, dan ETL-nya sudah ada, tetapi
  bagian ini belum dirender di halaman profil.
- **Cuaca dan iklim.** Modul ETL dan bagian "kondisi cuaca umum" untuk normal curah hujan BMKG
  (periode 1981–2010) sudah ada, dan `apps/web/src/data/weather.json` sudah dihasilkan untuk 510
  kabupaten/kota (4 sisanya berstatus tidak tersedia), tetapi bagian ini belum dipasang di halaman
  profil. Izin integrasi tertulis dari BMKG belum diperoleh.
- **Kondisi alam dan risiko.** Berkas `apps/web/src/data/nature.json` sudah dihasilkan (luas wilayah
  menurut peraturan dari BIG dan jumlah kejadian bencana BNPB per kabupaten/kota), tetapi belum
  dipasang di halaman profil. Tidak ada indeks risiko yang diterbitkan: angka BNPB adalah jumlah
  kejadian yang tercatat, bukan prakiraan, peringatan dini, atau penilaian bahaya.

## Stack

- Monorepo dan package manager: Bun workspaces dengan satu lockfile `bun.lock`.
- Formatter Oxfmt, linter Oxlint, TypeScript strict; type check eksplisit lewat `astro check` dan
  `tsc --noEmit`.
- Frontend: Astro (HTML statis), React islands hanya di titik yang butuh interaksi, Tailwind CSS,
  komponen `@almach/ui`.
- Server state frontend: TanStack Query; API client Eden Treaty dari `@jaga-daerah/api/client`,
  respons tetap divalidasi skema Zod saat runtime.
- API: Elysia dengan `CloudflareAdapter`, dikompilasi untuk Cloudflare Workers.
- Database: PostgreSQL terkelola, diakses Worker melalui Cloudflare Hyperdrive; akses dan schema
  memakai Drizzle ORM, migrasi dihasilkan dan diperiksa Drizzle Kit.
- Validasi dan kontrak: skema Zod di workspace bersama `packages/contracts`.
- Unit test: Bun test; E2E: Playwright.
- ETL: Python (dikelola uv), terpisah dari runtime aplikasi.

## Struktur Repository

Struktur aktual berikut mengikuti pohon batas repository di `AGENTS.md`; `packages/config/` dan
`packages/ui/` disebut di sana tetapi belum ada karena belum dipakai lebih dari satu workspace.

```text
apps/web/                 Frontend Astro
apps/api/                 Elysia API yang dikompilasi untuk Cloudflare Workers
packages/contracts/       Skema Zod, DTO, dan kode error publik (satu-satunya package bersama saat ini)
tools/etl/                ETL Python dan laporan kualitas data
tools/clean.ts            Pembersihan repository berbasis allowlist
database/migrations/      Migrasi PostgreSQL berurutan (hasil Drizzle Kit)
database/migrations/meta/ Snapshot dan journal migrasi Drizzle
database/roles/           Skrip grant role runtime (tanpa kredensial)
database/seeds/           Data referensi untuk development/test
docs/                     Dokumentasi arsitektur, development, keamanan, dan standar
```

Batas dependency mengikuti `AGENTS.md`: `apps/*` boleh bergantung pada `packages/*`, tetapi package
bersama tidak pernah mengimpor application workspace, dan satu-satunya impor antar-app adalah
`apps/web` → `@jaga-daerah/api/client`.

## Menjalankan

Prasyarat yang harus tersedia: **Bun 1.4.2** (versi yang di-pin `packageManager`), **uv** dengan
Python ≥ 3.13 untuk ETL, dan **binary PostgreSQL** (dipakai test database dan ETL; ditemukan lewat
`POSTGRES_BIN_DIR`, lalu `pg_config` di `PATH`, lalu versi terbaru di
`C:\Program Files\PostgreSQL\<versi>\bin`).

Setelah meng-clone repository ini:

```sh
bun install --frozen-lockfile
bun run dev:db setup   # sekali: buat cluster PostgreSQL lokal (.local/), migrasi, grant, import
                       # wilayah + data APBD/BNPB/SDA
bun run dev            # jalankan cluster bila perlu, lalu Astro (http://localhost:4321)
                       # dan Worker (http://localhost:8787/v1)
bun run dev:db stop    # hentikan cluster lokal (`status` untuk memeriksa)
```

Data lokal bersumber dari snapshot ETL yang tersegel. Bila belum ada, `dev:db setup` mengunduh lebih
dulu; secara manual:

```sh
bun run etl:fetch -- --years 2024,2025                    # unduh snapshot mentah DJPK + BNPB
bun run etl:publish -- --djpk <dir> --bnpb <dir> --load    # gerbang mutu, staging, aktivasi versi
```

Quality gate:

```sh
bun run check            # format:check + lint + typecheck + test (tanpa mengubah file)
bun run test             # unit, contract, dan component test (Bun test)
bun run test:db          # integrasi skema + API terhadap PostgreSQL sementara (butuh binary PostgreSQL)
bun run test:integration # route API di runtime workerd (wrangler dev + Hyperdrive lokal)
bun run test:etl         # test ETL Python (butuh uv)
bun run test:e2e         # Playwright: landing → pencarian → profil di 320 px dan desktop
bun run build            # build statis Astro + bundle Worker (wrangler --dry-run, tanpa deploy)
```

Untuk pertama kali, pasang browser Playwright sekali:

```sh
bun run --filter @jaga-daerah/web playwright install --only-shell chromium
```

ETL dijalankan terpisah dengan uv, misalnya:

```sh
bun run etl:regions                          # unduh + validasi kode wilayah Kepmendagri (tanpa tulis)
bun run etl:regions -- --load                # ... dan simpan ke database
```

Variabel lingkungan didokumentasikan di `.env.example` (inventaris nama variabel) dan
`docs/DEVELOPMENT.md`. Jangan menaruh nilai asli di dokumentasi atau commit: secret produksi berada di
penyimpanan secret Cloudflare/Wrangler, dan binding Hyperdrive bersifat per-environment.

## Sumber Data dan Lisensi

- **DJPK Kemenkeu** — APBD per kabupaten/kota (Portal Data SIKD, `periode=12`) dan ekspor TKDD untuk
  dana bagi hasil sumber daya alam (`djpk.kemenkeu.go.id/portal/data/apbd` dan `/portal/data/tkdd`).
  Syarat penggunaan ulangnya tidak dinyatakan di portal; JagaDaerah menampilkan angka apa adanya
  dengan atribusi di kredit footer situs.
- **BNPB** — "Kompilasi Data Kejadian dan Dampak Bencana" dari Portal Satu Data Bencana: lisensi
  ODbL untuk data 2024 dan ODC-BY untuk 2025.
- **Kemendagri** — Kepmendagri No. 300.2.2-2138 Tahun 2025 jo. No. 300.2.2-2430 Tahun 2025, dibaca
  lewat transkripsi MIT `cahyadsn/wilayah` yang dipin ke satu commit dan dicocokkan dengan rekap
  resminya.
- **Batas wilayah peta** — `cahyadsn/wilayah_boundaries` (MIT, commit dipin); disederhanakan oleh
  `tools/etl` dan hanya untuk tampilan, bukan acuan batas resmi. Kode wilayahnya mengikuti
  Kepmendagri 2025.
- **Wikipedia dan Wikimedia Commons** — 38 halaman daftar pejabat incumbent (CC BY-SA 4.0, setiap
  daerah menyebut URL revisi `oldid` yang dibaca) dan foto Commons dengan lisensi serta penulis
  masing-masing; foto hanya dipakai bila lisensinya bebas.
- **KPU** — "Info Pemilu — Pasangan Calon Pilkada 2024" (`infopemilu.kpu.go.id`) sebagai daftar
  rujukan pencocokan nama kepala daerah.
- **BIG** dan **BMKG** — dipakai oleh modul kondisi alam dan cuaca yang belum dipasang di halaman
  profil (lihat bagian di atas). BIG tidak mencantumkan lisensi untuk layanan luas wilayahnya, dan
  integrasi data BMKG memerlukan izin tertulis yang belum diperoleh; keduanya masih membawa risiko
  penggunaan ulang yang tercatat.

Detail pengambilan, pemetaan wilayah, dan gerbang mutunya ada di `tools/etl/README.md`.

## Dokumen

- [PRD](PRD.md) — lingkup produk, fitur, data, acceptance criteria, dan keputusan teknis.
- [Panduan agent](AGENTS.md) — aturan implementasi untuk kontributor dan coding agent.
- [Arsitektur](docs/ARCHITECTURE.md) — komponen sistem, data flow, dan batas tanggung jawab.
- [Development](docs/DEVELOPMENT.md) — workflow lokal, quality command, environment variable, dan ETL.
- [Security](docs/SECURITY.md) — threat model dan kontrol keamanan minimum.
- [Code standards](docs/CODE_STANDARDS.md) — batas modul, standar TypeScript, API, UI, dan Drizzle.
- [Testing](docs/TESTING.md) — lapisan test dan cakupan yang diwajibkan.
- [ETL](tools/etl/README.md) — sumber data, lisensi, pemetaan wilayah, dan gerbang mutu.
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md) — milestone implementasi dan exit criteria.
- [Project status](PROJECT_STATUS.md) — milestone aktif, bukti progres, dan risiko yang tersisa.
- [Contributing](CONTRIBUTING.md) — cara mengusulkan dan mengirim perubahan.

## License

Belum ditentukan. Jangan mengasumsikan izin penggunaan atau distribusi sebelum lisensi repository
ditetapkan.
