import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { formatCount } from '@/lib/format';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { OFFICIALS } from '@/lib/officials';
import { REGIONS } from '@/lib/regions';
import type { RegionSummary } from '@jaga-daerah/contracts';

export interface ChatAction {
  label: string;
  href: string;
}

export interface ChatMetricItem {
  label: string;
  value: string;
  sub?: string;
}

export interface AssistantResponse {
  text: string;
  metrics?: ChatMetricItem[];
  actions?: ChatAction[];
  suggestions?: string[];
}

export const INITIAL_SUGGESTIONS = [
  'Berapa anggaran Kota Bandung?',
  'Bandingkan Surabaya vs Malang',
  'Berapa rumah sakit di Kab. Sorong?',
  'Opini BPK Banda Aceh',
  'Catatan bencana di Jawa Barat',
] as const;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Matches common nicknames or aliases for Indonesian regions */
const ALIASES: Record<string, string> = {
  sby: 'kota-surabaya',
  surabaya: 'kota-surabaya',
  bdg: 'kota-bandung',
  bandung: 'kota-bandung',
  jogja: 'kota-yogyakarta',
  yogyakarta: 'kota-yogyakarta',
  dki: 'kota-administrasi-jakarta-pusat',
  jakarta: 'kota-administrasi-jakarta-pusat',
  jakpus: 'kota-administrasi-jakarta-pusat',
  jaksel: 'kota-administrasi-jakarta-selatan',
  jaktim: 'kota-administrasi-jakarta-timur',
  jakbar: 'kota-administrasi-jakarta-barat',
  jakut: 'kota-administrasi-jakarta-utara',
  makassar: 'kota-makassar',
  medan: 'kota-medan',
  malang: 'kota-malang',
  semarang: 'kota-semarang',
  solo: 'kota-surakarta',
  surakarta: 'kota-surakarta',
  denpasar: 'kota-denpasar',
  bali: 'kota-denpasar',
  ambon: 'kota-ambon',
  padang: 'kota-padang',
  palembang: 'kota-palembang',
  aceh: 'kota-banda-aceh',
  'banda aceh': 'kota-banda-aceh',
  sorong: 'kabupaten-sorong',
  jayapura: 'kota-jayapura',
};

function findRegionInText(text: string): RegionSummary | undefined {
  const norm = normalize(text);

  // Exact full name match (e.g. "Kota Bandung" or "Kabupaten Sorong") first
  for (const region of REGIONS) {
    const regNorm = normalize(region.name);
    if (norm.includes(regNorm)) {
      return region;
    }
  }

  // Check aliases
  for (const [alias, slug] of Object.entries(ALIASES)) {
    const pattern = new RegExp(`\\b${alias}\\b`);
    if (pattern.test(norm)) {
      const match = REGIONS.find((r) => r.slug === slug);
      if (match) return match;
    }
  }

  // If user explicitly specified "kota" or "kabupaten/kab"
  const hasKota = /\bkota\b/.test(norm);
  const hasKab = /\b(kabupaten|kab)\b/.test(norm);

  if (hasKota || hasKab) {
    for (const region of REGIONS) {
      const coreName = normalize(region.name.replace(/^(kabupaten|kota)\s+/i, ''));
      if (coreName.length >= 4 && new RegExp(`\\b${coreName}\\b`).test(norm)) {
        if (hasKota && region.type === 'kota') return region;
        if (hasKab && region.type === 'kabupaten') return region;
      }
    }
  }

  // Partial core name match (strip "kabupaten" / "kota")
  for (const region of REGIONS) {
    const coreName = normalize(region.name.replace(/^(kabupaten|kota)\s+/i, ''));
    if (coreName.length >= 4 && new RegExp(`\\b${coreName}\\b`).test(norm)) {
      return region;
    }
  }

  return undefined;
}

function findTwoRegions(text: string): [RegionSummary, RegionSummary] | undefined {
  const norm = normalize(text);

  const hasCompareIntent =
    norm.includes(' vs ') ||
    norm.includes('bandingkan') ||
    norm.includes('perbandingan') ||
    norm.includes('dibanding') ||
    norm.includes('mana lebih') ||
    norm.includes('banding ');

  if (!hasCompareIntent) {
    return undefined;
  }

  // Check for comparison connectors like "vs", "dan", "dengan", "bandingkan"
  const splitKeywords = [' vs ', ' bandingkan ', ' banding ', ' dengan ', ' dan ', ' dibanding '];
  for (const keyword of splitKeywords) {
    if (norm.includes(keyword)) {
      const parts = norm.split(keyword);
      if (parts[0] && parts[1]) {
        const r1 = findRegionInText(parts[0]);
        const r2 = findRegionInText(parts[1]);
        if (r1 && r2 && r1.code !== r2.code) {
          return [r1, r2];
        }
      }
    }
  }

  return undefined;
}

export function queryAssistant(rawQuery: string): AssistantResponse {
  const query = normalize(rawQuery);

  if (!query || query.length < 2) {
    return {
      text: 'Halo! Saya Asisten JagaDaerah. Anda bisa menanyakan anggaran APBD, fasilitas publik (rumah sakit & sekolah), jumlah penduduk, catatan bencana, atau perbandingan antar-daerah di Indonesia.',
      suggestions: [...INITIAL_SUGGESTIONS],
    };
  }

  // 1. Check for greeting / help intent
  if (['halo', 'hai', 'bantuan', 'tolong', 'menu', 'apa ini'].includes(query)) {
    return {
      text: 'Halo! Saya siap membantu Anda menelusuri data resmi 514 kabupaten/kota dari DJPK Kemenkeu, BNPB, Kemendagri Dukcapil, BPK RI, dan Kemenkes. Silakan tanyakan nama daerah atau pilih salah satu contoh di bawah ini:',
      suggestions: [
        'Berapa anggaran Kota Bandung?',
        'Bandingkan Surabaya vs Malang',
        'Fasilitas sekolah di Jayapura',
        'Opini BPK Kabupaten Sorong',
      ],
    };
  }

  // 2. Check for comparison intent
  const twoRegions = findTwoRegions(query);
  if (twoRegions) {
    const [r1, r2] = twoRegions;
    const r1Services = LOCAL_SERVICES.regions[r1.code];
    const r2Services = LOCAL_SERVICES.regions[r2.code];
    const r1Audit = AUDIT_OPINIONS.regions[r1.code]?.years?.[0]?.opinion ?? 'Belum tersedia';
    const r2Audit = AUDIT_OPINIONS.regions[r2.code]?.years?.[0]?.opinion ?? 'Belum tersedia';

    const r1Pop = r1Services?.population?.total
      ? `${formatCount(r1Services.population.total)} jiwa`
      : 'Belum tersedia';
    const r2Pop = r2Services?.population?.total
      ? `${formatCount(r2Services.population.total)} jiwa`
      : 'Belum tersedia';

    const r1Rs = r1Services?.hospitals?.total
      ? `${formatCount(r1Services.hospitals.total)} RS`
      : '0 RS';
    const r2Rs = r2Services?.hospitals?.total
      ? `${formatCount(r2Services.hospitals.total)} RS`
      : '0 RS';

    return {
      text: `Berikut adalah ringkasan perbandingan antara **${r1.name} (${r1.province.name})** dan **${r2.name} (${r2.province.name})** dari catatan resmi pemerintah:`,
      metrics: [
        { label: 'Penduduk', value: `${r1Pop} vs ${r2Pop}`, sub: 'Catatan Dukcapil 2024' },
        { label: 'Rumah Sakit', value: `${r1Rs} vs ${r2Rs}`, sub: 'Daftar SIRS Kemenkes' },
        {
          label: 'Opini BPK RI',
          value: `${r1Audit} vs ${r2Audit}`,
          sub: 'Laporan Keuangan Terakhir',
        },
      ],
      actions: [
        {
          label: `Buka Perbandingan Lengkap (${r1.name} vs ${r2.name})`,
          href: `/bandingkan?daerah1=${r1.slug}&daerah2=${r2.slug}`,
        },
      ],
      suggestions: [
        `Berapa anggaran ${r1.name}?`,
        `Berapa anggaran ${r2.name}?`,
        'Bandingkan Kota Medan vs Kota Padang',
      ],
    };
  }

  // 3. Single region query
  const region = findRegionInText(query);
  if (region) {
    const services = LOCAL_SERVICES.regions[region.code];
    const audit = AUDIT_OPINIONS.regions[region.code]?.years?.[0]?.opinion;
    const official = OFFICIALS.regions[region.code];
    const headName = official?.head?.name;
    const headTitle = region.type === 'kota' ? 'Wali Kota' : 'Bupati';

    // Topic: Fasilitas Kesehatan / RS
    if (query.includes('rumah sakit') || query.includes(' rs') || query.includes('kesehatan')) {
      const rsCount = services?.hospitals?.total;
      const pop = services?.population?.total;
      const ratio = rsCount && pop ? ((rsCount / pop) * 100_000).toFixed(1) : null;

      return {
        text: `Berdasarkan data Sistem Informasi Rumah Sakit (SIRS) Kemenkes, di **${region.name}** tercatat ada **${rsCount !== undefined ? formatCount(rsCount) : '0'} Rumah Sakit**${
          ratio ? ` (sekitar ${ratio} RS per 100.000 penduduk).` : '.'
        }`,
        metrics: [
          { label: 'Rumah Sakit Umum', value: `${services?.hospitals?.umum ?? 0} RS` },
          { label: 'RS Ibu & Anak', value: `${services?.hospitals?.ibu_anak ?? 0} RS` },
          { label: 'RS Khusus', value: `${services?.hospitals?.khusus ?? 0} RS` },
        ],
        actions: [
          { label: `Buka Profil ${region.name}`, href: `/daerah/${region.slug}#modul-layanan` },
        ],
        suggestions: [
          `Jumlah sekolah di ${region.name}`,
          `Berapa anggaran ${region.name}?`,
          `Bandingkan dengan daerah lain`,
        ],
      };
    }

    // Topic: Satuan Pendidikan / Sekolah
    if (
      query.includes('sekolah') ||
      query.includes('sd') ||
      query.includes('smp') ||
      query.includes('sma') ||
      query.includes('pendidikan')
    ) {
      const sch = services?.schools;
      const total = sch ? sch.sd + sch.smp + sch.sma + sch.smk : 0;

      return {
        text: `Berdasarkan portal referensi data Kemendikdasmen, di **${region.name}** terdapat **${formatCount(total)} satuan pendidikan** (SD, SMP, SMA, dan SMK).`,
        metrics: [
          { label: 'Sekolah Dasar (SD)', value: `${formatCount(sch?.sd ?? 0)}` },
          { label: 'Sekolah Menengah Pertama (SMP)', value: `${formatCount(sch?.smp ?? 0)}` },
          { label: 'SMA & SMK', value: `${formatCount((sch?.sma ?? 0) + (sch?.smk ?? 0))}` },
        ],
        actions: [
          { label: `Buka Profil ${region.name}`, href: `/daerah/${region.slug}#modul-layanan` },
        ],
        suggestions: [`Berapa rumah sakit di ${region.name}?`, `Berapa penduduk ${region.name}?`],
      };
    }

    // Topic: Penduduk
    if (
      query.includes('penduduk') ||
      query.includes('warga') ||
      query.includes('populasi') ||
      query.includes('jiwa')
    ) {
      const popTotal = services?.population?.total;
      return {
        text: `Berdasarkan catatan Ditjen Dukcapil Kemendagri per 31 Desember 2024, jumlah penduduk di **${region.name}** adalah **${popTotal !== undefined ? formatCount(popTotal) : 'Data belum tersedia'} jiwa**.`,
        metrics: [
          { label: 'Laki-laki', value: safeCount(services?.population?.male) },
          { label: 'Perempuan', value: safeCount(services?.population?.female) },
          { label: 'Total Penduduk', value: safeCount(popTotal, 'jiwa') },
        ],
        actions: [
          { label: `Buka Profil ${region.name}`, href: `/daerah/${region.slug}#modul-layanan` },
        ],
        suggestions: [`Berapa anggaran ${region.name}?`, `Rumah sakit di ${region.name}`],
      };
    }

    // Topic: Opini BPK
    if (
      query.includes('bpk') ||
      query.includes('opini') ||
      query.includes('wtp') ||
      query.includes('audit')
    ) {
      return {
        text: `Pada laporan keuangan tahun terakhir (2024), **${region.name}** memperoleh opini **${audit ?? 'Data belum tersedia'}** dari Badan Pemeriksa Keuangan (BPK RI).`,
        metrics: [
          { label: 'Opini LKPD', value: audit ?? 'Belum tersedia', sub: 'Tahun 2024' },
          {
            label: 'Tingkat Wilayah',
            value: region.type === 'kota' ? 'Pemerintah Kota' : 'Pemerintah Kabupaten',
          },
        ],
        actions: [
          { label: `Buka Profil ${region.name}`, href: `/daerah/${region.slug}#modul-opini` },
        ],
        suggestions: [`Berapa anggaran ${region.name}?`, `Siapa pejabat di ${region.name}?`],
      };
    }

    // Topic: Pejabat / Kepala Daerah
    if (
      query.includes('bupati') ||
      query.includes('walikota') ||
      query.includes('wali kota') ||
      query.includes('pejabat') ||
      query.includes('pemimpin')
    ) {
      return {
        text: `Berdasarkan catatan resmi yang dihimpun, ${headTitle} yang tercatat menjabat untuk **${region.name}** adalah **${headName ?? 'Data belum tersedia'}**${
          official?.head?.acting ? ' (sebagai Pelaksana Tugas / Plt)' : ''
        }.`,
        actions: [{ label: `Buka Profil ${region.name}`, href: `/daerah/${region.slug}#pejabat` }],
        suggestions: [`Berapa anggaran ${region.name}?`, `Opini BPK ${region.name}`],
      };
    }

    // Default / Anggaran overview for the matched region
    return {
      text: `Berikut adalah ringkasan data resmi untuk **${region.name} (${region.province.name})**. Anda dapat melihat realisasi APBD lengkap, fasilitas kesehatan, serta laporan bencana di halaman profil.`,
      metrics: [
        { label: 'Penduduk (Dukcapil)', value: safeCount(services?.population?.total, 'jiwa') },
        { label: 'Fasilitas RS (SIRS)', value: `${services?.hospitals?.total ?? 0} RS` },
        { label: 'Opini BPK', value: audit ?? 'Belum tersedia' },
        { label: headTitle, value: headName ?? 'Belum tersedia' },
      ],
      actions: [
        { label: `Lihat Profil Lengkap ${region.name}`, href: `/daerah/${region.slug}` },
        {
          label: `Bandingkan ${region.name} dengan daerah lain`,
          href: `/bandingkan?daerah1=${region.slug}`,
        },
      ],
      suggestions: [
        `Berapa rumah sakit di ${region.name}?`,
        `Jumlah sekolah di ${region.name}`,
        `Bandingkan ${region.name} dengan kabupaten/kota tetangga`,
      ],
    };
  }

  // 4. Topic-wide questions without specific region
  if (query.includes('bencana') || query.includes('gempa') || query.includes('cuaca')) {
    return {
      text: 'JagaDaerah menyajikan data gempa dan peringatan dini cuaca terkini langsung dari BMKG, serta data historis bencana provinsi dari BNPB.',
      actions: [
        { label: 'Buka Kondisi Terkini Nasional', href: '/#indonesia-sekarang' },
        { label: 'Buka Peta Wilayah', href: '/#peta' },
      ],
      suggestions: [
        'Catatan bencana di Jawa Barat',
        'Bencana di Sumatera Barat',
        'Berapa anggaran Kota Bandung?',
      ],
    };
  }

  if (
    query.includes('sumber') ||
    query.includes('data dari mana') ||
    query.includes('metodologi')
  ) {
    return {
      text: 'Semua angka di JagaDaerah dihimpun dari publikasi resmi pemerintah: DJPK Kemenkeu (APBD), BNPB (Bencana), BMKG (Gempa & Cuaca), BPK RI (Opini audit), Ditjen Dukcapil (Penduduk), SIRS Kemenkes (Rumah Sakit), dan Kemendikdasmen (Sekolah).',
      actions: [{ label: 'Pelajari Semua Sumber Data', href: '/sumber' }],
      suggestions: [...INITIAL_SUGGESTIONS],
    };
  }

  // Fallback when query cannot be understood
  return {
    text: `Saya belum menemukan data khusus untuk pencarian "${rawQuery}". Coba sebutkan nama kabupaten atau kota secara spesifik, atau klik contoh pertanyaan di bawah ini:`,
    suggestions: [
      'Berapa anggaran Kota Bandung?',
      'Bandingkan Surabaya vs Malang',
      'Berapa rumah sakit di Kab. Sorong?',
      'Opini BPK Banda Aceh',
    ],
  };
}

function safeCount(value?: number | null, suffix = ''): string {
  if (value === null || value === undefined) return 'Belum tersedia';
  return `${formatCount(value)}${suffix ? ' ' + suffix : ''}`;
}
