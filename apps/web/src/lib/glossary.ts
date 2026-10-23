// Plain-language definitions for terms that appear in profiles. Kept in one place so an inline
// `Term` and the glossary section cannot drift apart. Definitions describe the official figure,
// not a judgement about performance (PRD §7.5).

export interface GlossaryEntry {
  id: string;
  label: string;
  definition: string;
  note?: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: 'apbd',
    label: 'APBD',
    definition:
      'Anggaran Pendapatan dan Belanja Daerah: rencana penerimaan dan belanja pemerintah kabupaten/kota untuk satu tahun.',
  },
  {
    id: 'realisasi',
    label: 'Realisasi',
    definition:
      'Uang yang sudah benar-benar dibayarkan atau diterima sampai periode laporan, bukan angka rencana.',
    note: 'Realisasi bisa lebih rendah dari anggaran karena pembayaran belum selesai atau kegiatan belum berjalan.',
  },
  {
    id: 'median-nasional',
    label: 'Median nasional',
    definition:
      'Nilai tengah dari persentase realisasi semua kabupaten/kota yang datanya lengkap pada tahun yang sama.',
    note: 'Separuh daerah berada di atas nilai ini dan separuh di bawahnya. Ini pembanding, bukan nilai kelulusan.',
  },
  {
    id: 'pad',
    label: 'Pendapatan asli daerah (PAD)',
    definition:
      'Penerimaan daerah dari pajak daerah, retribusi, hasil pengelolaan kekayaan daerah, dan lain-lain PAD yang sah.',
    note: 'PAD adalah kas daerah, bukan penghasilan warga.',
  },
  {
    id: 'transfer',
    label: 'Transfer',
    definition:
      'Uang yang diterima daerah dari pemerintah pusat atau provinsi, misalnya dana alokasi umum, dana alokasi khusus, dan bagi hasil.',
  },
  {
    id: 'dbh-sda',
    label: 'Dana bagi hasil SDA',
    definition:
      'Bagian penerimaan negara dari minyak, gas, tambang, hutan, ikan, panas bumi, dan sawit yang ditransfer ke daerah.',
    note: 'Angka ini bukan ukuran kekayaan atau cadangan alam daerah.',
  },
  {
    id: 'belanja-modal',
    label: 'Belanja modal',
    definition:
      'Belanja untuk membentuk aset tetap yang manfaatnya lebih dari satu tahun, seperti jalan, jembatan, gedung, dan peralatan.',
  },
  {
    id: 'belanja-pegawai',
    label: 'Belanja pegawai',
    definition:
      'Belanja untuk gaji dan tunjangan aparatur sipil negara, termasuk guru dan tenaga kesehatan yang berstatus ASN.',
  },
  {
    id: 'opini-bpk',
    label: 'Opini BPK',
    definition:
      'Kesimpulan Badan Pemeriksa Keuangan atas kewajaran penyajian laporan keuangan pemerintah daerah.',
    note: 'Opini menilai laporan keuangannya, bukan menilai pejabat dan bukan temuan korupsi.',
  },
  {
    id: 'wtp',
    label: 'WTP',
    definition:
      'Wajar Tanpa Pengecualian: BPK menilai laporan keuangan disajikan secara wajar dalam semua hal yang material.',
  },
  {
    id: 'sanitasi-layak',
    label: 'Sanitasi layak',
    definition:
      'Rumah tangga dengan jamban leher angsa milik sendiri atau bersama, dan pembuangan akhir tinja berupa tangki septik atau sistem pengolahan air limbah.',
    note: 'Bukan sanitasi aman, dan bukan status desa bebas buang air besar sembarangan.',
  },
  {
    id: 'bencana-provinsi',
    label: 'Bencana tingkat provinsi',
    definition:
      'Data BNPB dirangkum per provinsi, sehingga profil kabupaten/kota menampilkan kejadian di provinsi induknya.',
    note: 'Angka ini tidak menunjukkan berapa kejadian yang terjadi tepat di kabupaten/kota tersebut.',
  },
  {
    id: 'penduduk-dukcapil',
    label: 'Jumlah penduduk Dukcapil',
    definition:
      'Jumlah jiwa pada Data Konsolidasi Bersih Ditjen Dukcapil per 31 Desember 2024, bukan proyeksi BPS.',
  },
] as const;

const BY_ID = new Map(GLOSSARY.map((entry) => [entry.id, entry]));

export function glossaryEntry(id: string): GlossaryEntry {
  const entry = BY_ID.get(id);
  if (entry === undefined) {
    throw new Error(`Unknown glossary term: ${id}`);
  }
  return entry;
}
