import { ELECTRIFICATION_NATIONAL, ELECTRIFICATION_SOURCE } from '@/lib/map-layers';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { SANITATION } from '@/lib/sanitation';
import { WELFARE } from '@/lib/welfare';

export interface CatalogLink {
  label: string;
  href: string;
}

export interface CatalogSource {
  id: string;
  publisher: string;
  title: string;
  period: string;
  caveat: string;
  links: CatalogLink[];
}

export interface CatalogGroup {
  id: string;
  title: string;
  sources: CatalogSource[];
}

const hospitals = LOCAL_SERVICES.hospitals;
const population = LOCAL_SERVICES.population;

export const SOURCE_CATALOG: CatalogGroup[] = [
  {
    id: 'wilayah',
    title: 'Wilayah',
    sources: [
      {
        id: 'batas',
        publisher: 'cahyadsn/wilayah_boundaries',
        title: 'Batas kabupaten/kota untuk peta',
        period: 'Kepmendagri No. 300.2.2-2138 jo. 300.2.2-2430 Tahun 2025',
        caveat:
          'Poligon resmi yang disederhanakan untuk tampilan. Lisensi MIT, commit 28230eca6e78. Peta dasar di beranda terpisah dari batas ini.',
        links: [
          {
            label: 'Repositori batas',
            href: 'https://github.com/cahyadsn/wilayah_boundaries',
          },
        ],
      },
      {
        id: 'luas',
        publisher: 'Badan Informasi Geospasial',
        title: 'Luas wilayah menurut peraturan',
        period: 'Layanan batas administrasi kabupaten/kota',
        caveat:
          'Angka luas kabupaten/kota. Penerbit tidak mencantumkan izin tertulis untuk pemakaian ulang.',
        links: [{ label: 'Layanan BIG', href: 'https://geoservices.big.go.id/portal/home/' }],
      },
    ],
  },
  {
    id: 'penduduk',
    title: 'Penduduk dan penghidupan',
    sources: [
      {
        id: 'penduduk-dukcapil',
        publisher: population.source.publisher,
        title: population.source.title,
        period: '31 Desember 2024',
        caveat:
          'Jumlah administrasi, bukan Sensus BPS. Berkasnya satu tabel nasional berkode Kemendagri. Semester I 2025 lebih baru, tetapi tidak ada berkas kabupaten/kota berkode untuk semester itu.',
        links: [{ label: 'Tabel berkode', href: population.source.url }],
      },
      {
        id: 'kemiskinan',
        publisher: WELFARE.poverty.source.publisher,
        title: WELFARE.poverty.source.title,
        period: 'Susenas Maret 2025',
        caveat:
          'Jumlah penduduk miskin dalam ribu jiwa, persentase, dan garis kemiskinan. Bukan hasil bagi dengan angka Dukcapil.',
        links: [{ label: 'Buku BPS', href: WELFARE.poverty.source.url }],
      },
      {
        id: 'pdrb',
        publisher: WELFARE.output.source.publisher,
        title: WELFARE.output.source.title,
        period: '2025, angka sangat sementara',
        caveat:
          'PDRB per kapita harga berlaku, dalam ribu rupiah. Ini hasil ekonomi daerah per orang, bukan gaji. Empat provinsi hasil pemekaran Papua tidak punya angka 2025 yang terbaca.',
        links: [{ label: 'Buku BPS', href: WELFARE.output.source.url }],
      },
      {
        id: 'ipm',
        publisher: WELFARE.development.source.publisher,
        title: WELFARE.development.source.title,
        period: '2025',
        caveat:
          'Indeks pembangunan manusia dan pengeluaran riil per kapita yang disesuaikan. Pengeluaran riil bukan upah.',
        links: [{ label: 'Buku BPS', href: WELFARE.development.source.url }],
      },
      {
        id: 'sanitasi',
        publisher: SANITATION.source.publisher,
        title: SANITATION.source.title,
        period: 'Susenas KOR 2025',
        caveat:
          'Persentase rumah tangga dengan jamban leher angsa sendiri atau bersama dan tangki septik atau pengolahan air limbah, dari Susenas KOR. Bukan status desa stop buang air besar sembarangan, dan bukan sanitasi aman. Kabupaten Puncak tidak punya angka 2025; kosong bukan nol. Nama BPS dicocokkan ke kode Kemendagri. Mamuju Utara dibaca sebagai Pasangkayu.',
        links: [{ label: 'Tabel BPS', href: SANITATION.source.url }],
      },
    ],
  },
  {
    id: 'layanan',
    title: 'Rumah sakit, sekolah, dan listrik',
    sources: [
      {
        id: 'rumah-sakit',
        publisher: hospitals.source.publisher,
        title: hospitals.source.title,
        period: 'Daftar saat berkas diambil',
        caveat: `${hospitals.omitted} baris tidak dihitung. Kode rumah sakit bukan kode Kemendagri. Nama dihitung bila menunjuk satu daerah. Nama yang sama untuk kabupaten dan kota dihitung hanya jika koordinat peta SIRS jatuh di tepat satu dari dua batas itu. Nama, alamat, dan telepon tidak disimpan.`,
        links: [
          { label: 'Daftar jumlah', href: hospitals.source.url },
          { label: 'Koordinat peta SIRS', href: hospitals.coordinates.url },
        ],
      },
      {
        id: 'sekolah',
        publisher: LOCAL_SERVICES.schools.source.publisher,
        title: LOCAL_SERVICES.schools.source.title,
        period: 'Saat berkas diambil, tanpa tahun ajaran',
        caveat:
          'SD dan SMP dari halaman dikdas, SMA dan SMK dari halaman dikmen. SLB tidak dijumlahkan. Ini jumlah sekolah, bukan murid.',
        links: [
          { label: 'Dikdas', href: LOCAL_SERVICES.schools.source.url },
          {
            label: 'Dikmen',
            href: 'https://referensi.data.kemendikdasmen.go.id/pendidikan/dikmen',
          },
        ],
      },
      {
        id: 'listrik',
        publisher: 'Ditjen Ketenagalistrikan, ESDM',
        title: ELECTRIFICATION_SOURCE.title,
        period: '2024',
        caveat: `Rasio rumah tangga berlistrik per provinsi. Nasional ${ELECTRIFICATION_NATIONAL.replace('.', ',')}%. Setiap kabupaten/kota memakai angka provinsinya. ESDM tidak menerbitkan rasio per kabupaten/kota.`,
        links: [{ label: 'Buku statistik', href: ELECTRIFICATION_SOURCE.url }],
      },
    ],
  },
  {
    id: 'keuangan',
    title: 'Keuangan daerah',
    sources: [
      {
        id: 'apbd-jenis',
        publisher: 'DJPK Kemenkeu',
        title: 'Realisasi belanja menurut jenis',
        period: 'Per tahun yang dipilih di profil',
        caveat:
          'Rincian belanja per pemda dari Portal Data SIKD. Pemda yang tidak ada di berkas dikosongkan, tidak diisi nol.',
        links: [{ label: 'Portal APBD', href: 'https://djpk.kemenkeu.go.id/portal/data/apbd' }],
      },
      {
        id: 'apbd-fungsi',
        publisher: 'DJPK Kemenkeu',
        title: 'Realisasi belanja menurut fungsi, 2024',
        period: '2024',
        caveat: 'Satu berkas nasional per fungsi. Bukan penilaian kinerja.',
        links: [
          {
            label: 'Berkas 2024',
            href: 'https://djpk.kemenkeu.go.id/wp-content/uploads/2025/11/31102025_Realisasi_Belanja_Daerah_2024.xlsx',
          },
        ],
      },
      {
        id: 'pendapatan',
        publisher: 'DJPK Kemenkeu',
        title: 'Realisasi pendapatan daerah menurut jenis, 2024',
        period: '2024',
        caveat: 'Jenis di bawah pendapatan daerah. Pemda yang tidak ada di berkas dikosongkan.',
        links: [
          {
            label: 'Berkas 2024',
            href: 'https://djpk.kemenkeu.go.id/wp-content/uploads/2025/11/31102025_Data_Realisasi_Ringkas_APBD_2024.xlsx',
          },
        ],
      },
      {
        id: 'tkdd',
        publisher: 'DJPK Kemenkeu',
        title: 'Dana bagi hasil sumber daya alam',
        period: 'Per tahun yang dipilih di profil',
        caveat: 'Bagian yang diterima daerah dari transfer ke daerah, bukan cadangan sumber daya.',
        links: [{ label: 'Portal TKDD', href: 'https://djpk.kemenkeu.go.id/portal/data/tkdd' }],
      },
      {
        id: 'opini',
        publisher: 'Badan Pemeriksa Keuangan',
        title: 'Opini laporan keuangan pemerintah daerah',
        period: '2016–2024',
        caveat:
          'Opini atas laporan keuangan, bukan atas pejabat dan bukan temuan korupsi. Enam kode administrasi DKI memakai opini Provinsi DKI.',
        links: [
          {
            label: 'Daftar opini',
            href: 'https://data.bpk.go.id/Opini/download_csv/D15C3FD8-5135-42E1-81DF-888A70CB7891',
          },
        ],
      },
    ],
  },
  {
    id: 'alam',
    title: 'Alam',
    sources: [
      {
        id: 'bencana',
        publisher: 'BNPB',
        title: 'Kejadian dan dampak bencana',
        period: 'Per tahun pada profil',
        caveat:
          'Angka yang ditampilkan mengikuti tingkat yang tertulis di berkas. Bukan prakiraan.',
        links: [
          {
            label: 'Data bencana Indonesia',
            href: 'https://data.bnpb.go.id/dataset/data-bencana-indonesia',
          },
        ],
      },
      {
        id: 'tutupan-lahan',
        publisher: 'KLHK',
        title: 'Luas penutupan lahan per provinsi, 2023',
        period: '2023',
        caveat:
          'Tingkat provinsi, empat kelas. Host statistik.menlhk.go.id sudah tidak terurai; yang terpasang adalah tabel yang tersimpan.',
        links: [
          {
            label: 'Rekapitulasi PKTL',
            href: 'https://statistik.menlhk.go.id/sisklhkX/data_statistik/pktl/table1_0',
          },
        ],
      },
      {
        id: 'hujan',
        publisher: 'BMKG',
        title: 'Normal curah hujan bulanan',
        period: '1981–2010',
        caveat:
          'Normal iklim, bukan cuaca hari ini. Ketentuan BMKG mensyaratkan izin tertulis untuk integrasi ke aplikasi pihak ketiga; izin itu belum tercatat.',
        links: [
          {
            label: 'Peta normal hujan',
            href: 'https://gis.bmkg.go.id/arcgis/rest/services/Normal_hujan_30th/Normal_curah_hujan/MapServer',
          },
        ],
      },
    ],
  },
  {
    id: 'pemerintahan',
    title: 'Pemerintahan',
    sources: [
      {
        id: 'pilkada',
        publisher: 'KPU',
        title: 'Pasangan calon Pilkada 2024',
        period: '2024',
        caveat: 'Nama, pendidikan, pekerjaan, dan visi yang calon sampaikan ke KPU.',
        links: [
          {
            label: 'Info Pemilu',
            href: 'https://infopemilu.kpu.go.id/Pemilihan/Pasangan_calon',
          },
        ],
      },
      {
        id: 'pejabat',
        publisher: 'Wikipedia, dicocokkan dengan KPU',
        title: 'Kepala daerah dan wakil yang menjabat',
        period: 'Revisi yang disematkan per provinsi',
        caveat:
          'Teks CC BY-SA 4.0. Setiap profil menautkan revisi yang dipakai. Foto mengikuti lisensi berkasnya di Wikimedia Commons.',
        links: [
          {
            label: 'Lisensi CC BY-SA 4.0',
            href: 'https://creativecommons.org/licenses/by-sa/4.0/deed.id',
          },
        ],
      },
      {
        id: 'lhkpn',
        publisher: 'KPK',
        title: 'e-Announcement LHKPN',
        period: 'Tautan keluar',
        caveat: 'Situs ini tidak menyimpan angka harta. Pencarian dilakukan di situs KPK.',
        links: [{ label: 'e-LHKPN', href: 'https://elhkpn.kpk.go.id/' }],
      },
    ],
  },
  {
    id: 'terkini',
    title: 'Kondisi terkini dan peta dasar',
    sources: [
      {
        id: 'cuaca',
        publisher: 'BMKG',
        title: 'Prakiraan cuaca dan peringatan dini',
        period: 'Saat halaman dibuka',
        caveat:
          'Prakiraan dan judul peringatan dini. Bukan pernyataan bahwa suatu daerah aman. Jika BMKG menutup akses, bagian ini dimatikan.',
        links: [
          { label: 'Prakiraan cuaca', href: 'https://www.bmkg.go.id/' },
          { label: 'Nowcast', href: 'https://www.bmkg.go.id/alerts/nowcast/id' },
        ],
      },
      {
        id: 'udara',
        publisher: 'KLH/BPLH',
        title: 'Indeks Standar Pencemar Udara',
        period: 'Pembacaan stasiun saat halaman dibuka',
        caveat:
          'Angka tiap stasiun, bukan rata-rata kabupaten. Saran mengikuti teks yang ditayangkan situs ISPU. Alamat stasiun tidak disimpan.',
        links: [{ label: 'Situs ISPU', href: 'https://ispu.kemenlh.go.id/' }],
      },
      {
        id: 'gempa',
        publisher: 'BMKG',
        title: 'Gempa bumi terbaru',
        period: 'Saat halaman dibuka',
        caveat:
          'Lima gempa terbaru pada beranda. Di profil, gempa dalam 72 jam dan sekitar 200 km.',
        links: [{ label: 'Informasi gempabumi', href: 'https://data.bmkg.go.id/gempabumi/' }],
      },
      {
        id: 'peta-dasar',
        publisher: 'CARTO dan OpenStreetMap',
        title: 'Peta dasar beranda',
        period: 'Ubin vektor saat peta dimuat',
        caveat:
          'Hanya latar peta di beranda. Warna daerah tetap dari data JagaDaerah di atas poligon resmi. Peta profil tidak memakai ubin ini.',
        links: [
          {
            label: 'Gaya Positron',
            href: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
          },
          { label: 'Hak cipta OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' },
        ],
      },
    ],
  },
];
