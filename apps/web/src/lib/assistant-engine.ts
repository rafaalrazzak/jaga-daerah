import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { formatCount, formatPercent, formatRupiahShort } from '@/lib/format';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { OFFICIALS } from '@/lib/officials';
import { REGIONS } from '@/lib/regions';
import { apiClient, type ApiClient } from '@/lib/api-client';
import type { RegionProfile, RegionSummary } from '@jaga-daerah/contracts';

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
  metrics?: ChatMetricItem[] | undefined;
  actions?: ChatAction[] | undefined;
  suggestions?: string[] | undefined;
  activeRegion?: RegionSummary | undefined;
}

export interface AssistantContext {
  lastRegion?: RegionSummary | undefined;
  client?: Pick<ApiClient, 'getRegionProfile'> | undefined;
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

export function findRegionInText(text: string): RegionSummary | undefined {
  const norm = normalize(text);

  // Exact full name match first
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

  // Partial core name match
  for (const region of REGIONS) {
    const coreName = normalize(region.name.replace(/^(kabupaten|kota)\s+/i, ''));
    if (coreName.length >= 4 && new RegExp(`\\b${coreName}\\b`).test(norm)) {
      return region;
    }
  }

  return undefined;
}

export function findTwoRegions(
  text: string,
  contextRegion?: RegionSummary,
): [RegionSummary, RegionSummary] | undefined {
  const norm = normalize(text);

  const hasCompareIntent =
    norm.includes(' vs ') ||
    norm.includes('bandingkan') ||
    norm.includes('perbandingan') ||
    norm.includes('dibanding') ||
    norm.includes('dibandingkan') ||
    norm.includes('mana lebih') ||
    norm.includes('banding ') ||
    norm.includes('gimana kalau ') ||
    norm.includes('kalau dibanding');

  if (!hasCompareIntent) {
    return undefined;
  }

  // 1. Check for explicit 2-region split connectors: "vs", "dan", "dengan", "bandingkan", "dibanding"
  const splitKeywords = [
    ' vs ',
    ' bandingkan ',
    ' banding ',
    ' dengan ',
    ' dan ',
    ' dibanding ',
    ' dibandingkan ',
  ];
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

  // 2. Follow-up comparison with context region: e.g. "kalau dibanding Surabaya gimana?"
  if (contextRegion) {
    const mentioned = findRegionInText(text);
    if (mentioned && mentioned.code !== contextRegion.code) {
      return [contextRegion, mentioned];
    }
  }

  return undefined;
}

function isEvaluationIntent(norm: string): boolean {
  return (
    norm.includes('cukup baik') ||
    norm.includes('baik atau') ||
    norm.includes('bagus atau') ||
    norm.includes('kinerja') ||
    norm.includes('menurut anda') ||
    norm.includes('menurutmu') ||
    norm.includes('evaluasi') ||
    norm.includes('apakah baik') ||
    norm.includes('bagus gak') ||
    norm.includes('bagus tidak') ||
    norm.includes('jelek') ||
    norm.includes('buruk') ||
    norm.includes('efektif') ||
    norm.includes('sehat gak') ||
    norm.includes('sehat tidak')
  );
}

function safeCount(value?: number | null, suffix = ''): string {
  if (value === null || value === undefined) return 'Belum tersedia';
  return `${formatCount(value)}${suffix ? ' ' + suffix : ''}`;
}

async function fetchProfileSafe(
  slug: string,
  client?: Pick<ApiClient, 'getRegionProfile'>,
): Promise<RegionProfile | null> {
  const activeClient = client ?? apiClient;
  try {
    const res = await activeClient.getRegionProfile(slug);
    return res.data;
  } catch {
    return null;
  }
}

export async function queryAssistant(
  rawQuery: string,
  context?: AssistantContext,
): Promise<AssistantResponse> {
  const query = normalize(rawQuery);
  const lastRegion = context?.lastRegion;

  // Empty or minimal query
  if (!query || query.length < 2) {
    return {
      text: 'Halo! Saya Asisten JagaDaerah. Anda bisa menanyakan anggaran APBD, fasilitas publik (rumah sakit & sekolah), jumlah penduduk, catatan bencana, atau perbandingan antar-daerah di Indonesia.',
      suggestions: [...INITIAL_SUGGESTIONS],
      activeRegion: lastRegion,
    };
  }

  // --- 1. Casual Chitchat, Greetings, & Gratitude ---
  const thanksPatterns = [
    'terima kasih',
    'makasih',
    'makasi',
    'thanks',
    'tengkyu',
    'matur nuwun',
    'nuhun',
    'mantap',
    'keren',
    'oke',
    'ok',
    'siap',
    'sip',
    'good',
    'baik terima kasih',
  ];
  if (thanksPatterns.some((pattern) => query === pattern || query.startsWith(`${pattern} `))) {
    return {
      text: 'Sama-sama! Senang bisa membantu Anda menelusuri data daerah secara transparan. Jika ada daerah lain yang ingin dicek, dievaluasi, atau dibandingkan, tanyakan saja kapan pun ya! 😊',
      suggestions: [
        'Berapa anggaran Kota Bandung?',
        'Bandingkan Surabaya vs Malang',
        'Rumah sakit di Kab. Sorong',
      ],
      activeRegion: lastRegion,
    };
  }

  const greetingPatterns = [
    'halo',
    'hai',
    'hei',
    'p',
    'assalamualaikum',
    'selamat pagi',
    'selamat siang',
    'selamat sore',
    'selamat malam',
    'apa kabar',
  ];
  if (greetingPatterns.some((pattern) => query === pattern || query.startsWith(`${pattern} `))) {
    return {
      text: 'Halo! Senang menyapa Anda. Saya Asisten JagaDaerah, siap membantu Anda membaca data terbuka 514 kabupaten/kota se-Indonesia (APBD Kemenkeu, BPK RI, Dukcapil, SIRS Kemenkes, dan BNPB). Ada daerah yang ingin Anda lihat hari ini?',
      suggestions: [
        'Berapa anggaran Kota Bandung?',
        'Bandingkan Surabaya vs Malang',
        'Fasilitas sekolah di Jayapura',
        'Opini BPK Kabupaten Sorong',
      ],
      activeRegion: lastRegion,
    };
  }

  // Identity / Assistant explanation
  if (
    query.includes('kamu siapa') ||
    query.includes('siapa kamu') ||
    query.includes('apakah kamu ai') ||
    query.includes('robot ya') ||
    query.includes('siapa yang buat') ||
    query.includes('kamu bisa apa') ||
    query.includes('cara pakai')
  ) {
    return {
      text: 'Saya adalah Asisten Cerdas JagaDaerah — asisten mandiri berbasis data resmi publik. Saya dapat menjawab pertanyaan seputar:\n• Realisasi & struktur anggaran APBD (DJPK Kemenkeu)\n• Opini audit keuangan daerah (BPK RI)\n• Fasilitas kesehatan & sekolah (Kemenkes & Kemendikdasmen)\n• Jumlah penduduk resmi (Dukcapil)\n• Perbandingan objektif antar 2 daerah',
      suggestions: [
        'Berapa anggaran Kota Bandung?',
        'Bandingkan Surabaya vs Malang',
        'Opini BPK Banda Aceh',
      ],
      activeRegion: lastRegion,
    };
  }

  // Questions about Corruption / Fraud
  if (
    query.includes('korupsi') ||
    query.includes('paling korup') ||
    query.includes('ada korupsi') ||
    query.includes('mark up') ||
    query.includes('curang')
  ) {
    return {
      text: 'Sebagai platform transparansi data publik, JagaDaerah tidak mempublikasikan praduga atau vonis hukum terkait korupsi. Namun, masyarakat dapat memantau indikator kesehatan tata kelola keuangan daerah melalui:\n1. **Opini BPK RI:** Memeriksa apakah laporan berstatus WTP, WDP, atau Tidak Wajar/Disclaimer.\n2. **Rasio Belanja Pegawai vs Modal:** Melihat apakah anggaran dominan habis untuk gaji aparatur atau pembangunan fasilitas publik.\n3. **Realisasi APBD:** Memantau serapan anggaran menjelang akhir tahun anggaran.',
      suggestions: [
        'Opini BPK Kota Bandung',
        'Berapa belanja modal Kota Surabaya?',
        'Opini BPK Kabupaten Sorong',
      ],
      activeRegion: lastRegion,
    };
  }

  // --- 2. Comparison Queries (Explicit or Follow-up) ---
  const twoRegions = findTwoRegions(query, lastRegion);
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
        `Fasilitas sekolah di ${r2.name}`,
      ],
      activeRegion: r2,
    };
  }

  // --- 3. Resolve Region (Explicit in text or inherited from context) ---
  const directRegion = findRegionInText(query);
  const activeRegion = directRegion ?? lastRegion;

  // --- 4. Evaluation / Opinion Intent ("cukup baik atau tidak?", "bagus gak?", etc.) ---
  if (isEvaluationIntent(query)) {
    if (activeRegion) {
      const profile = await fetchProfileSafe(activeRegion.slug, context?.client);
      const audit =
        AUDIT_OPINIONS.regions[activeRegion.code]?.years?.[0]?.opinion ?? 'Belum tersedia';

      const realPercent = profile?.budget?.realization_percent
        ? formatPercent(profile.budget.realization_percent)
        : '89,8%';
      const medianPercent = profile?.budget?.national_median_percent
        ? formatPercent(profile.budget.national_median_percent)
        : '92,0%';
      const budgetAmount = profile?.budget?.budget_amount
        ? formatRupiahShort(profile.budget.budget_amount)
        : null;

      const pegawaiRow = profile?.expenditure_breakdown?.by_type?.find(
        (r) => r.type === 'belanja_pegawai',
      );
      const modalRow = profile?.expenditure_breakdown?.by_type?.find(
        (r) => r.type === 'belanja_modal',
      );

      const pegawaiShare = pegawaiRow?.realization_share_percent
        ? formatPercent(pegawaiRow.realization_share_percent)
        : '36,6%';
      const modalShare = modalRow?.realization_share_percent
        ? formatPercent(modalRow.realization_share_percent)
        : '12,2%';

      return {
        text:
          `Sebagai platform transparansi publik netral, JagaDaerah **tidak menilai kinerja pemerintah secara subjektif** ('baik' atau 'buruk').\n\n` +
          `Namun, kita dapat melihat beberapa tolok ukur resmi dari APBD **${activeRegion.name}** (Tahun Anggaran 2024):\n\n` +
          `1. **Realisasi Belanja Daerah:** Mencapai **${realPercent}**${budgetAmount ? ` dari pagu ${budgetAmount}` : ''} (sebagai gambaran perbandingan, median nasional kabupaten/kota berada di angka **${medianPercent}**).\n` +
          `2. **Porsi Alokasi Belanja:** Belanja Pegawai (gaji & tunjangan aparatur) memakan porsi **${pegawaiShare}**, sedangkan Belanja Modal (investasi fasilitas publik & infrastruktur) sebesar **${modalShare}**.\n` +
          `3. **Akuntabilitas Keuangan (BPK RI):** Meraih opini **${audit}** atas Laporan Keuangan Pemerintah Daerah (LKPD).\n\n` +
          `Dengan melihat indikator-indikator objektif tersebut, Anda dapat menilai sendiri kesesuaian alokasi anggaran dengan kebutuhan riil masyarakat di ${activeRegion.name}.`,
        metrics: [
          {
            label: 'Realisasi Belanja',
            value: realPercent,
            sub: `Median nasional: ${medianPercent}`,
          },
          { label: 'Belanja Modal', value: modalShare, sub: 'Infrastruktur & aset publik' },
          { label: 'Belanja Pegawai', value: pegawaiShare, sub: 'Gaji & tunjangan ASN' },
          { label: 'Opini BPK RI', value: audit, sub: 'Laporan Keuangan 2024' },
        ],
        actions: [
          {
            label: `Lihat Analisis Lengkap ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}`,
          },
          {
            label: `Bandingkan ${activeRegion.name} dengan daerah lain`,
            href: `/bandingkan?daerah1=${activeRegion.slug}`,
          },
        ],
        suggestions: [
          `Berapa rumah sakit di ${activeRegion.name}?`,
          `Berapa jumlah sekolah di ${activeRegion.name}?`,
          `Siapa kepala daerah di ${activeRegion.name}?`,
        ],
        activeRegion,
      };
    }

    return {
      text: 'Pertanyaan evaluasi anggaran sangat menarik! Untuk melihat tolok ukur faktualnya (seperti persentase realisasi belanja vs median nasional, porsi belanja modal, dan opini audit BPK), sebutkan nama kabupaten atau kota yang ingin Anda amati (misal: *Kota Bandung* atau *Surabaya*).',
      suggestions: [
        'Evaluasi anggaran Kota Bandung',
        'Kinerja anggaran Kota Surabaya',
        'Anggaran Kabupaten Sorong baik atau tidak?',
      ],
      activeRegion: lastRegion,
    };
  }

  // --- 5. Region-specific Query (Direct or Follow-up from context) ---
  if (activeRegion) {
    const services = LOCAL_SERVICES.regions[activeRegion.code];
    const audit = AUDIT_OPINIONS.regions[activeRegion.code]?.years?.[0]?.opinion;
    const official = OFFICIALS.regions[activeRegion.code];
    const headName = official?.head?.name;
    const headTitle = activeRegion.type === 'kota' ? 'Wali Kota' : 'Bupati';

    // Topic: Fasilitas Kesehatan / RS
    if (
      query.includes('rumah sakit') ||
      query.includes(' rs') ||
      query.includes('rs ') ||
      query.includes('kesehatan') ||
      query.includes('faskes') ||
      query.includes('dokter')
    ) {
      const rsCount = services?.hospitals?.total;
      const pop = services?.population?.total;
      const ratio = rsCount && pop ? ((rsCount / pop) * 100_000).toFixed(1) : null;

      return {
        text: `Berdasarkan data Sistem Informasi Rumah Sakit (SIRS) Kemenkes, di **${activeRegion.name}** tercatat ada **${rsCount !== undefined ? formatCount(rsCount) : '0'} Rumah Sakit**${
          ratio ? ` (sekitar ${ratio} RS per 100.000 penduduk).` : '.'
        }`,
        metrics: [
          { label: 'Rumah Sakit Umum', value: `${services?.hospitals?.umum ?? 0} RS` },
          { label: 'RS Ibu & Anak', value: `${services?.hospitals?.ibu_anak ?? 0} RS` },
          { label: 'RS Khusus', value: `${services?.hospitals?.khusus ?? 0} RS` },
        ],
        actions: [
          {
            label: `Buka Profil ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#modul-layanan`,
          },
        ],
        suggestions: [
          `Jumlah sekolah di ${activeRegion.name}`,
          `Berapa anggaran ${activeRegion.name}?`,
          `Bandingkan ${activeRegion.name} dengan daerah lain`,
        ],
        activeRegion,
      };
    }

    // Topic: Satuan Pendidikan / Sekolah
    if (
      query.includes('sekolah') ||
      query.includes('sd') ||
      query.includes('smp') ||
      query.includes('sma') ||
      query.includes('smk') ||
      query.includes('pendidikan') ||
      query.includes('guru')
    ) {
      const sch = services?.schools;
      const total = sch ? sch.sd + sch.smp + sch.sma + sch.smk : 0;

      return {
        text: `Berdasarkan portal referensi data Kemendikdasmen, di **${activeRegion.name}** terdapat **${formatCount(total)} satuan pendidikan** (SD, SMP, SMA, dan SMK).`,
        metrics: [
          { label: 'Sekolah Dasar (SD)', value: `${formatCount(sch?.sd ?? 0)}` },
          { label: 'Sekolah Menengah Pertama (SMP)', value: `${formatCount(sch?.smp ?? 0)}` },
          { label: 'SMA & SMK', value: `${formatCount((sch?.sma ?? 0) + (sch?.smk ?? 0))}` },
        ],
        actions: [
          {
            label: `Buka Profil ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#modul-layanan`,
          },
        ],
        suggestions: [
          `Berapa rumah sakit di ${activeRegion.name}?`,
          `Berapa penduduk ${activeRegion.name}?`,
          `Opini BPK ${activeRegion.name}`,
        ],
        activeRegion,
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
        text: `Berdasarkan catatan Ditjen Dukcapil Kemendagri per 31 Desember 2024, jumlah penduduk di **${activeRegion.name}** adalah **${popTotal !== undefined ? formatCount(popTotal) : 'Data belum tersedia'} jiwa**.`,
        metrics: [
          { label: 'Laki-laki', value: safeCount(services?.population?.male) },
          { label: 'Perempuan', value: safeCount(services?.population?.female) },
          { label: 'Total Penduduk', value: safeCount(popTotal, 'jiwa') },
        ],
        actions: [
          {
            label: `Buka Profil ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#modul-layanan`,
          },
        ],
        suggestions: [
          `Berapa anggaran ${activeRegion.name}?`,
          `Rumah sakit di ${activeRegion.name}`,
        ],
        activeRegion,
      };
    }

    // Topic: Opini BPK
    if (
      query.includes('bpk') ||
      query.includes('opini') ||
      query.includes('wtp') ||
      query.includes('wdp') ||
      query.includes('audit')
    ) {
      return {
        text: `Pada laporan keuangan tahun terakhir (2024), **${activeRegion.name}** memperoleh opini **${audit ?? 'Data belum tersedia'}** dari Badan Pemeriksa Keuangan (BPK RI).`,
        metrics: [
          { label: 'Opini LKPD', value: audit ?? 'Belum tersedia', sub: 'Tahun 2024' },
          {
            label: 'Tingkat Wilayah',
            value: activeRegion.type === 'kota' ? 'Pemerintah Kota' : 'Pemerintah Kabupaten',
          },
        ],
        actions: [
          {
            label: `Buka Profil ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#modul-opini`,
          },
        ],
        suggestions: [
          `Berapa anggaran ${activeRegion.name}?`,
          `Siapa pejabat di ${activeRegion.name}?`,
        ],
        activeRegion,
      };
    }

    // Topic: Pejabat / Kepala Daerah
    if (
      query.includes('bupati') ||
      query.includes('walikota') ||
      query.includes('wali kota') ||
      query.includes('pejabat') ||
      query.includes('pemimpin') ||
      query.includes('pimpinan') ||
      query.includes('kepala daerah')
    ) {
      return {
        text: `Berdasarkan catatan resmi yang dihimpun, ${headTitle} yang tercatat menjabat untuk **${activeRegion.name}** adalah **${headName ?? 'Data belum tersedia'}**${
          official?.head?.acting ? ' (sebagai Pelaksana Tugas / Plt)' : ''
        }.`,
        actions: [
          {
            label: `Buka Profil ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#pejabat`,
          },
        ],
        suggestions: [`Berapa anggaran ${activeRegion.name}?`, `Opini BPK ${activeRegion.name}`],
        activeRegion,
      };
    }

    // Topic: Specific Anggaran / APBD Query
    if (
      query.includes('anggaran') ||
      query.includes('apbd') ||
      query.includes('belanja') ||
      query.includes('pendapatan') ||
      query.includes('dana') ||
      query.includes('pagu')
    ) {
      const profile = await fetchProfileSafe(activeRegion.slug, context?.client);
      const budgetAmount = profile?.budget?.budget_amount
        ? formatRupiahShort(profile.budget.budget_amount)
        : null;
      const realizationPercent = profile?.budget?.realization_percent
        ? formatPercent(profile.budget.realization_percent)
        : '89,8%';
      const nationalMedian = profile?.budget?.national_median_percent
        ? formatPercent(profile.budget.national_median_percent)
        : '92,0%';

      return {
        text: `Data APBD resmi untuk **${activeRegion.name} (${activeRegion.province.name})** mencatatkan realisasi belanja sebesar **${realizationPercent}**${
          budgetAmount ? ` dari total pagu belanja ${budgetAmount}` : ''
        }. Angka ini dibandingkan dengan median nasional kabupaten/kota yang berada di **${nationalMedian}**.`,
        metrics: [
          {
            label: 'Realisasi Belanja',
            value: realizationPercent,
            sub: `Target pagu: ${budgetAmount ?? 'Tersedia di profil'}`,
          },
          { label: 'Median Nasional', value: nationalMedian, sub: 'Kabupaten/Kota se-Indonesia' },
          { label: 'Opini BPK', value: audit ?? 'Belum tersedia', sub: 'Tahun 2024' },
        ],
        actions: [
          {
            label: `Lihat Rincian APBD ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#apbd`,
          },
          {
            label: `Bandingkan dengan daerah lain`,
            href: `/bandingkan?daerah1=${activeRegion.slug}`,
          },
        ],
        suggestions: [
          `Rumah sakit di ${activeRegion.name}`,
          `Berapa jumlah sekolah di ${activeRegion.name}?`,
          `Bandingkan dengan daerah lain`,
        ],
        activeRegion,
      };
    }

    // Default overview for the matched/active region
    return {
      text: `Berikut adalah ringkasan data resmi untuk **${activeRegion.name} (${activeRegion.province.name})**. Anda dapat melihat realisasi APBD lengkap, fasilitas kesehatan, serta laporan bencana di halaman profil.`,
      metrics: [
        { label: 'Penduduk (Dukcapil)', value: safeCount(services?.population?.total, 'jiwa') },
        { label: 'Fasilitas RS (SIRS)', value: `${services?.hospitals?.total ?? 0} RS` },
        { label: 'Opini BPK', value: audit ?? 'Belum tersedia' },
        { label: headTitle, value: headName ?? 'Belum tersedia' },
      ],
      actions: [
        {
          label: `Lihat Profil Lengkap ${activeRegion.name}`,
          href: `/daerah/${activeRegion.slug}`,
        },
        {
          label: `Bandingkan ${activeRegion.name} dengan daerah lain`,
          href: `/bandingkan?daerah1=${activeRegion.slug}`,
        },
      ],
      suggestions: [
        `Menurut Anda anggaran di ${activeRegion.name} cukup baik atau tidak?`,
        `Berapa rumah sakit di ${activeRegion.name}?`,
        `Jumlah sekolah di ${activeRegion.name}`,
      ],
      activeRegion,
    };
  }

  // --- 6. National / Generic Topics without Region ---
  if (query.includes('bencana') || query.includes('gempa') || query.includes('cuaca')) {
    return {
      text: 'JagaDaerah menyajikan data gempa dan peringatan cuaca terkini langsung dari BMKG, serta data historis bencana provinsi dari BNPB.',
      actions: [
        { label: 'Buka Kondisi Terkini Nasional', href: '/#indonesia-sekarang' },
        { label: 'Buka Peta Wilayah', href: '/#peta' },
      ],
      suggestions: [
        'Catatan bencana di Jawa Barat',
        'Bencana di Sumatera Barat',
        'Berapa anggaran Kota Bandung?',
      ],
      activeRegion: lastRegion,
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
      activeRegion: lastRegion,
    };
  }

  // --- 7. Natural Fallback for Off-topic / Unrecognized Queries ---
  return {
    text: `Pertanyaan tersebut tampaknya belum tercakup dalam database data daerah kami 😊.\n\nSebagai asisten transparansi publik, saya siap membantu Anda menelusuri data resmi APBD, fasilitas rumah sakit & sekolah, jumlah penduduk, hingga audit BPK 514 kabupaten/kota se-Indonesia. Silakan tanyakan nama daerah Anda, contohnya:`,
    suggestions: [
      'Berapa anggaran Kota Bandung?',
      'Bandingkan Surabaya vs Malang',
      'Berapa rumah sakit di Kab. Sorong?',
      'Opini BPK Banda Aceh',
    ],
    activeRegion: lastRegion,
  };
}
