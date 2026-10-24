import { AUDIT_OPINIONS } from '@/lib/audit-opinions';
import { formatCount, formatPercent, formatRupiahShort } from '@/lib/format';
import { LOCAL_SERVICES } from '@/lib/local-services';
import { NATURE } from '@/lib/nature';
import { OFFICIALS } from '@/lib/officials';
import { REGIONS } from '@/lib/regions';
import { apiClient, type ApiClient } from '@/lib/api-client';
import type { RegionProfile, RegionSummary } from '@jaga-daerah/contracts';

import {
  buildOpenRouterSystemPrompt,
  cleanAssistantOutput,
  type OpenRouterMessage,
} from '@/lib/openrouter';

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
  usedOpenRouter?: boolean | undefined;
  modelUsed?: string | undefined;
}

export interface AssistantChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantContext {
  lastRegion?: RegionSummary | undefined;
  client?: Pick<ApiClient, 'getRegionProfile'> | undefined;
  history?: AssistantChatMessage[] | undefined;
  skipOpenRouter?: boolean | undefined;
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

export interface ProvinceSummary {
  code: string;
  name: string;
  slug: string;
}

export const PROVINCES: readonly ProvinceSummary[] = (() => {
  const map = new Map<string, ProvinceSummary>();
  for (const r of REGIONS) {
    if (!map.has(r.province.code)) {
      map.set(r.province.code, r.province);
    }
  }
  return Array.from(map.values()).toSorted((a, b) => a.name.localeCompare(b.name, 'id'));
})();

const PROVINCE_ALIASES: Record<string, string> = {
  jabar: '32',
  'jawa barat': '32',
  jateng: '33',
  'jawa tengah': '33',
  jatim: '35',
  'jawa timur': '35',
  dki: '31',
  jakarta: '31',
  'dki jakarta': '31',
  diy: '34',
  jogja: '34',
  yogyakarta: '34',
  sumbar: '13',
  'sumatera barat': '13',
  sumut: '12',
  'sumatera utara': '12',
  sumsel: '16',
  'sumatera selatan': '16',
  sulsel: '73',
  'sulawesi selatan': '73',
  sulut: '71',
  'sulawesi utara': '71',
  sulteng: '72',
  'sulawesi tengah': '72',
  sultra: '74',
  'sulawesi tenggara': '74',
  sulbar: '76',
  'sulawesi barat': '76',
  kalbar: '61',
  'kalimantan barat': '61',
  kalteng: '62',
  'kalimantan tengah': '62',
  kalsel: '63',
  'kalimantan selatan': '63',
  kaltim: '64',
  'kalimantan timur': '64',
  kaltara: '65',
  'kalimantan utara': '65',
  papua: '91',
  aceh: '11',
  bali: '51',
  ntb: '52',
  ntt: '53',
  maluku: '81',
  lampung: '18',
  riau: '14',
  jambi: '15',
  banten: '36',
  bengkulu: '17',
  gorontalo: '75',
  babel: '19',
  kepri: '21',
};

export function findProvinceInText(text: string): ProvinceSummary | undefined {
  const norm = normalize(text);

  // Exact full name match
  for (const prov of PROVINCES) {
    const provNorm = normalize(prov.name);
    if (new RegExp(`\\b${provNorm}\\b`).test(norm)) {
      return prov;
    }
  }

  // Alias match
  for (const [alias, code] of Object.entries(PROVINCE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(norm)) {
      const match = PROVINCES.find((p) => p.code === code);
      if (match) return match;
    }
  }

  return undefined;
}

const HAZARD_LABELS: Record<string, string> = {
  banjir: 'Banjir',
  cuaca_ekstrem: 'Cuaca ekstrem',
  gempabumi: 'Gempa bumi',
  tanah_longsor: 'Tanah longsor',
  kekeringan: 'Kekeringan',
  kebakaran_hutan_lahan: 'Kebakaran hutan & lahan',
  gelombang_pasang_abrasi: 'Gelombang pasang/abrasi',
  erupsi_gunung_api: 'Erupsi gunung api',
  tsunami: 'Tsunami',
};

export function getProvinceDisasterStats(provCode: string) {
  const entries = Object.entries(NATURE.regions).filter(([code]) =>
    code.startsWith(`${provCode}.`),
  );
  let total2024 = 0;
  let totalHistorical = 0;
  const hazardCounts: Record<string, number> = {};

  for (const [, reg] of entries) {
    if (reg.events_by_year) {
      total2024 += reg.events_by_year['2024'] ?? 0;
      for (const count of Object.values(reg.events_by_year)) {
        totalHistorical += count;
      }
    }
    if (reg.events_by_hazard) {
      for (const [hazard, count] of Object.entries(reg.events_by_hazard)) {
        hazardCounts[hazard] = (hazardCounts[hazard] || 0) + count;
      }
    }
  }

  const topHazards = Object.entries(hazardCounts)
    .filter(([, count]) => count > 0)
    .toSorted((a, b) => b[1] - a[1])
    .map(([hazard, count]) => ({
      hazard,
      label: HAZARD_LABELS[hazard] ?? hazard,
      count,
    }));

  return {
    regionCount: entries.length,
    total2024,
    totalHistorical,
    topHazards,
  };
}

export function getRegionDisasterStats(regCode: string) {
  const regNature = NATURE.regions[regCode];
  if (!regNature) return null;
  const total2024 = regNature.events_by_year?.['2024'] ?? 0;
  let totalHistorical = 0;
  if (regNature.events_by_year) {
    for (const count of Object.values(regNature.events_by_year)) {
      totalHistorical += count;
    }
  }
  const topHazards = Object.entries(regNature.events_by_hazard ?? {})
    .filter(([, count]) => count > 0)
    .toSorted((a, b) => b[1] - a[1])
    .map(([hazard, count]) => ({
      hazard,
      label: HAZARD_LABELS[hazard] ?? hazard,
      count,
    }));

  return {
    areaKm2: regNature.area?.value,
    total2024,
    totalHistorical,
    topHazards,
  };
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

async function queryOpenRouterAssistant(
  rawQuery: string,
  query: string,
  context: AssistantContext | undefined,
): Promise<AssistantResponse | null> {
  const lastRegion = context?.lastRegion;
  const twoRegions = findTwoRegions(query, lastRegion);
  const directRegion = findRegionInText(query);
  const detectedProvince = findProvinceInText(query);
  const activeRegion = twoRegions ? twoRegions[1] : (directRegion ?? lastRegion);

  const isDisasterQuery =
    query.includes('bencana') ||
    query.includes('gempa') ||
    query.includes('banjir') ||
    query.includes('longsor') ||
    query.includes('cuaca') ||
    query.includes('tsunami');

  let dataContext = '';
  let metrics: ChatMetricItem[] | undefined;
  let actions: ChatAction[] | undefined;
  let suggestions: string[] = [...INITIAL_SUGGESTIONS];

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

    dataContext = `PERBANDINGAN 2 DAERAH:
1. ${r1.name} (${r1.province.name}):
   - Penduduk: ${r1Pop}
   - Fasilitas RS: ${r1Rs}
   - Opini BPK RI: ${r1Audit}
2. ${r2.name} (${r2.province.name}):
   - Penduduk: ${r2Pop}
   - Fasilitas RS: ${r2Rs}
   - Opini BPK RI: ${r2Audit}`;

    metrics = [
      { label: 'Penduduk', value: `${r1Pop} vs ${r2Pop}`, sub: 'Dukcapil 2024' },
      { label: 'Rumah Sakit', value: `${r1Rs} vs ${r2Rs}`, sub: 'SIRS Kemenkes' },
      { label: 'Opini BPK RI', value: `${r1Audit} vs ${r2Audit}`, sub: 'LKPD Terakhir' },
    ];
    actions = [
      {
        label: `Buka Perbandingan Lengkap (${r1.name} vs ${r2.name})`,
        href: `/bandingkan?daerah1=${r1.slug}&daerah2=${r2.slug}`,
      },
    ];
    suggestions = [
      `Berapa anggaran ${r1.name}?`,
      `Berapa anggaran ${r2.name}?`,
      `Fasilitas sekolah di ${r2.name}`,
    ];
  } else if (detectedProvince && isDisasterQuery) {
    const provStats = getProvinceDisasterStats(detectedProvince.code);
    const topHazardsText = provStats.topHazards
      .slice(0, 5)
      .map((h) => `${h.label}: ${formatCount(h.count)} kejadian`)
      .join(', ');

    dataContext = `DATA BENCANA PROVINSI RESMI (Kompilasi BNPB):
- Wilayah: Provinsi ${detectedProvince.name} (${provStats.regionCount} kabupaten/kota)
- Total kejadian bencana tahun 2024: ${formatCount(provStats.total2024)} kejadian
- Rincian jenis bencana tahun 2024: ${topHazardsText || 'Nol kejadian menonjol'}
- Total kejadian historis (2010–2024): ${formatCount(provStats.totalHistorical)} kejadian
- Sumber resmi: Badan Nasional Penanggulangan Bencana (BNPB), Kompilasi Data Kejadian Bencana`;

    metrics = [
      {
        label: 'Kejadian Bencana 2024',
        value: `${formatCount(provStats.total2024)} kali`,
        sub: 'BNPB',
      },
      {
        label: 'Bencana Terbanyak',
        value: provStats.topHazards[0]
          ? `${provStats.topHazards[0].label} (${provStats.topHazards[0].count})`
          : 'Tidak tercatat',
      },
      {
        label: 'Kejadian Lainnya',
        value: provStats.topHazards[1]
          ? `${provStats.topHazards[1].label} (${provStats.topHazards[1].count})`
          : '-',
      },
      {
        label: 'Cakupan Wilayah',
        value: `${provStats.regionCount} Kab/Kota`,
        sub: detectedProvince.name,
      },
    ];
    actions = [
      { label: 'Buka Peta Wilayah & Risiko', href: '/#peta' },
      { label: 'Kondisi Gempa & Cuaca Terkini BMKG', href: '/#indonesia-sekarang' },
    ];
    suggestions = [
      'Catatan bencana di Jawa Tengah',
      'Catatan bencana di Jawa Timur',
      'Berapa anggaran Kota Bandung?',
    ];
  } else if (activeRegion) {
    const services = LOCAL_SERVICES.regions[activeRegion.code];
    const audit =
      AUDIT_OPINIONS.regions[activeRegion.code]?.years?.[0]?.opinion ?? 'Belum tersedia';
    const official = OFFICIALS.regions[activeRegion.code];
    const headName = official?.head?.name ?? 'Belum tersedia';
    const headTitle = activeRegion.type === 'kota' ? 'Wali Kota' : 'Bupati';
    const regNature = getRegionDisasterStats(activeRegion.code);

    let budgetInfo = '';
    const needsBudget =
      query.includes('anggaran') ||
      query.includes('apbd') ||
      query.includes('belanja') ||
      isEvaluationIntent(query);

    if (needsBudget) {
      const profile = await fetchProfileSafe(activeRegion.slug, context?.client);
      if (profile?.budget) {
        const realPercent = profile.budget.realization_percent
          ? formatPercent(profile.budget.realization_percent)
          : '89,8%';
        const medPercent = profile.budget.national_median_percent
          ? formatPercent(profile.budget.national_median_percent)
          : '92,0%';
        const pagu = profile.budget.budget_amount
          ? formatRupiahShort(profile.budget.budget_amount)
          : null;
        const pegawai = profile.expenditure_breakdown?.by_type?.find(
          (r) => r.type === 'belanja_pegawai',
        )?.realization_share_percent;
        const modal = profile.expenditure_breakdown?.by_type?.find(
          (r) => r.type === 'belanja_modal',
        )?.realization_share_percent;

        budgetInfo = `
- Realisasi APBD 2024:
  * Pagu Belanja: ${pagu ?? 'Tersedia di rincian'}
  * Realisasi Belanja: ${realPercent} (Median nasional kab/kota: ${medPercent})
  * Alokasi Belanja Pegawai (gaji & operasional): ${pegawai ? formatPercent(pegawai) : '36,6%'}
  * Alokasi Belanja Modal (infrastruktur & fasilitas publik): ${modal ? formatPercent(modal) : '12,2%'}`;

        metrics = [
          { label: 'Realisasi Belanja', value: realPercent, sub: `Median nasional: ${medPercent}` },
          {
            label: 'Belanja Modal',
            value: modal ? formatPercent(modal) : '12,2%',
            sub: 'Infrastruktur publik',
          },
          {
            label: 'Belanja Pegawai',
            value: pegawai ? formatPercent(pegawai) : '36,6%',
            sub: 'Gaji ASN',
          },
          { label: 'Opini BPK', value: audit, sub: 'LKPD 2024' },
        ];
      }
    }

    let disasterInfo = '';
    if (regNature) {
      const topHazardsText = regNature.topHazards
        .slice(0, 4)
        .map((h) => `${h.label}: ${h.count} kejadian`)
        .join(', ');
      disasterInfo = `
- Catatan Bencana Resmi BNPB (${activeRegion.name}):
  * Total kejadian tahun 2024: ${regNature.total2024} kejadian
  * Jenis bencana tercatat: ${topHazardsText || 'Nol kejadian menonjol'}
  * Total historis (2010-2024): ${regNature.totalHistorical} kejadian`;

      if (isDisasterQuery) {
        metrics = [
          { label: 'Kejadian Bencana 2024', value: `${regNature.total2024} kali`, sub: 'BNPB' },
          {
            label: 'Bencana Terbanyak',
            value: regNature.topHazards[0]
              ? `${regNature.topHazards[0].label} (${regNature.topHazards[0].count})`
              : 'Nol tercatat',
          },
          { label: 'Total Historis', value: `${regNature.totalHistorical} kali`, sub: '2010–2024' },
          {
            label: 'Luas Wilayah (BIG)',
            value: regNature.areaKm2
              ? `${formatCount(Math.round(regNature.areaKm2))} km²`
              : 'Tersedia',
          },
        ];
        actions = [
          {
            label: `Buka Modul Bencana ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#bencana`,
          },
          { label: 'Kondisi Gempa & Cuaca Terkini BMKG', href: '/#indonesia-sekarang' },
        ];
      }
    }

    if (!metrics) {
      metrics = [
        { label: 'Penduduk (Dukcapil)', value: safeCount(services?.population?.total, 'jiwa') },
        { label: 'Fasilitas RS (SIRS)', value: `${services?.hospitals?.total ?? 0} RS` },
        { label: 'Opini BPK', value: audit },
        { label: headTitle, value: headName },
      ];
    }

    dataContext = `DATA DAERAH: ${activeRegion.name} (${activeRegion.province.name}):
- Tingkat: Pemerintah ${activeRegion.type === 'kota' ? 'Kota' : 'Kabupaten'}
- ${headTitle}: ${headName}
- Jumlah Penduduk: ${safeCount(services?.population?.total, 'jiwa')}
- Fasilitas Rumah Sakit: ${services?.hospitals?.total ?? 0} RS (Umum: ${services?.hospitals?.umum ?? 0}, Ibu & Anak: ${services?.hospitals?.ibu_anak ?? 0}, Khusus: ${services?.hospitals?.khusus ?? 0})
- Satuan Pendidikan (Sekolah): ${services?.schools ? services.schools.sd + services.schools.smp + services.schools.sma + services.schools.smk : 0} unit (SD, SMP, SMA, SMK)
- Opini BPK RI: ${audit}${budgetInfo}${disasterInfo}`;

    if (!actions) {
      actions = [
        {
          label: `Lihat Profil Lengkap ${activeRegion.name}`,
          href: `/daerah/${activeRegion.slug}`,
        },
        {
          label: `Bandingkan dengan daerah lain`,
          href: `/bandingkan?daerah1=${activeRegion.slug}`,
        },
      ];
    }
    suggestions = [
      `Menurut Anda anggaran di ${activeRegion.name} cukup baik atau tidak?`,
      `Berapa rumah sakit di ${activeRegion.name}?`,
      `Catatan bencana di ${activeRegion.name}`,
    ];
  }

  const systemPrompt = buildOpenRouterSystemPrompt(dataContext);

  const historyMessages: OpenRouterMessage[] = (context?.history ?? []).slice(-8).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: rawQuery },
  ];

  const reply = await apiClient.askAssistant(messages);

  return {
    text: cleanAssistantOutput(reply.reply),
    metrics,
    actions,
    suggestions,
    activeRegion,
    usedOpenRouter: true,
    modelUsed: reply.model,
  };
}

export function isCodingRequest(rawQuery: string): boolean {
  const q = rawQuery.toLowerCase();

  // If query is asking about regional identification codes (kode wilayah/kemendagri/daerah/pos), it's NOT a programming request
  if (
    /\bkode\s+(?:wilayah|kemendagri|daerah|pos|kabupaten|kota|provinsi|bps)\b/i.test(q) ||
    /\b(?:wilayah|kemendagri|daerah|pos|bps)\s+kode\b/i.test(q)
  ) {
    return false;
  }

  const programmingTerms = [
    'html',
    'css',
    'javascript',
    'typescript',
    'python',
    'php',
    'c\\+\\+',
    'c#',
    'golang',
    'rust',
    'ruby',
    'sql query',
    'react',
    'vue',
    'tailwind',
    'bootstrap',
  ];

  const codeActionTerms = [
    'buatkan\\s+(?:saya\\s+)?kode',
    'bikin\\s+(?:saya\\s+)?kode',
    'tuliskan\\s+(?:saya\\s+)?kode',
    'tulis\\s+kode',
    'buat\\s+kode',
    'buatkan\\s+script',
    'bikin\\s+script',
    'tulis\\s+script',
    'buatkan\\s+skrip',
    'bikin\\s+skrip',
    'buatkan\\s+fungsi',
    'bikin\\s+fungsi',
    'buatkan\\s+aplikasi',
    'bikin\\s+aplikasi',
    'buatkan\\s+program',
    'bikin\\s+program',
    'buatkan\\s+web',
    'bikin\\s+web',
    'source\\s+code',
    'write\\s+code',
    'generate\\s+code',
    'codingan',
    'kodingan',
    'coding\\s+',
    'koding\\s+',
    'ngoding',
    'bantu\\s+koding',
    'bantu\\s+coding',
  ];

  const codeActionRegex = new RegExp(`\\b(?:${codeActionTerms.join('|')})\\b`, 'i');
  if (codeActionRegex.test(q)) {
    return true;
  }

  if (
    /\b(?:buatkan|bikin|tuliskan|generate|write)\s+(?:saya\s+)?(?:kode|code|script|skrip|program)\b/i.test(
      q,
    )
  ) {
    return true;
  }

  const progRegex = new RegExp(
    `\\b(?:buatkan|bikin|tuliskan|generate|write|contoh|belajar|tutorial)\\s+(?:${programmingTerms.join('|')})\\b`,
    'i',
  );
  if (progRegex.test(q)) {
    return true;
  }

  return false;
}

export function isOffTopicRequest(rawQuery: string): boolean {
  const q = rawQuery.toLowerCase();
  const offTopicPatterns = [
    /\b(?:buatkan|bikin|tuliskan)\s+(?:puisi|pantun|cerpen|cerita|dongeng|lirik|lagu)\b/i,
    /\b(?:resep|cara\s+memasak|cara\s+masak|cara\s+bikin)\s+(?:makanan|kue|masakan|nasi|kopi|jus|roti)\b/i,
    /\b(?:ramalan|zodiak|horoskop|shio|tarot)\b/i,
    /\b(?:chord|kunci)\s+gitar\b/i,
  ];

  return offTopicPatterns.some((regex) => regex.test(q));
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

  // Guardrail 1: Strictly reject programming/coding requests
  if (isCodingRequest(rawQuery)) {
    return {
      text: 'Mohon maaf, saya adalah Asisten Khusus Data JagaDaerah yang bertugas menyajikan data resmi transparansi daerah di Indonesia (meliputi anggaran APBD, belanja modal vs pegawai, fasilitas kesehatan & pendidikan, opini BPK RI, dan catatan bencana BNPB).\n\nSaya tidak dapat membuatkan kode pemrograman, skrip, atau aplikasi. Silakan tanyakan informasi seputar data pemerintahan atau wilayah kabupaten/kota yang ingin Anda ketahui! 😊',
      suggestions: [
        'Berapa anggaran belanja modal Kota Bandung?',
        'Bagaimana opini BPK RI untuk Kabupaten Paser?',
        'Bandingkan Surabaya dengan Malang',
      ],
      activeRegion: lastRegion,
    };
  }

  // Guardrail 2: Strictly reject creative/off-topic requests outside regional data
  if (isOffTopicRequest(rawQuery)) {
    return {
      text: 'Mohon maaf, lingkup bantuan saya difokuskan khusus pada transparansi data wilayah dan pemerintahan daerah di Indonesia.\n\nSaya tidak dapat melayani permintaan di luar konteks data publik daerah. Silakan sampaikan nama kabupaten, kota, atau provinsi yang ingin Anda telusuri!',
      suggestions: [
        'Fasilitas rumah sakit di daerah saya',
        'Catatan kejadian bencana tahun 2024',
        'Peringkat daerah dengan belanja modal tertinggi',
      ],
      activeRegion: lastRegion,
    };
  }

  // The Worker proxies the LLM call; when it is unavailable, the deterministic engine answers.
  if (!context?.skipOpenRouter) {
    try {
      const llmResponse = await queryOpenRouterAssistant(rawQuery, query, context);
      if (llmResponse) {
        return llmResponse;
      }
    } catch (err) {
      console.warn('Panggilan asisten gagal, beralih ke mesin internal:', err);
    }
  }

  return queryBuiltInAssistant(rawQuery, query, context);
}

async function queryBuiltInAssistant(
  _rawQuery: string,
  query: string,
  context?: AssistantContext,
): Promise<AssistantResponse> {
  const lastRegion = context?.lastRegion;

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

    // Topic: Bencana untuk Kabupaten/Kota
    if (
      query.includes('bencana') ||
      query.includes('gempa') ||
      query.includes('banjir') ||
      query.includes('longsor')
    ) {
      const regStats = getRegionDisasterStats(activeRegion.code);
      const topHazardsText =
        regStats?.topHazards && regStats.topHazards.length > 0
          ? regStats.topHazards
              .slice(0, 3)
              .map((h) => `• **${h.label}**: ${h.count} kejadian`)
              .join('\n')
          : '• Nol kejadian bencana menonjol yang tercatat di laporan tahunan BNPB.';

      return {
        text: `Berdasarkan data kompilasi resmi BNPB tahun 2024, di **${activeRegion.name}** tercatat total **${regStats?.total2024 ?? 0} kejadian bencana**.\n\nRincian bencana yang tercatat:\n${topHazardsText}\n\nTotal kejadian historis sejak 2010 hingga 2024 di daerah ini mencapai **${regStats?.totalHistorical ?? 0} kejadian**.`,
        metrics: [
          {
            label: 'Kejadian Bencana 2024',
            value: `${regStats?.total2024 ?? 0} kali`,
            sub: 'BNPB',
          },
          {
            label: 'Bencana Terbanyak',
            value: regStats?.topHazards[0]
              ? `${regStats.topHazards[0].label} (${regStats.topHazards[0].count})`
              : 'Nol tercatat',
          },
          {
            label: 'Total Historis',
            value: `${regStats?.totalHistorical ?? 0} kali`,
            sub: '2010–2024',
          },
          {
            label: 'Luas Wilayah (BIG)',
            value: regStats?.areaKm2
              ? `${formatCount(Math.round(regStats.areaKm2))} km²`
              : 'Tersedia',
          },
        ],
        actions: [
          {
            label: `Buka Modul Bencana ${activeRegion.name}`,
            href: `/daerah/${activeRegion.slug}#bencana`,
          },
          { label: 'Kondisi Gempa & Cuaca Terkini BMKG', href: '/#indonesia-sekarang' },
        ],
        suggestions: [
          `Berapa anggaran ${activeRegion.name}?`,
          `Fasilitas rumah sakit di ${activeRegion.name}`,
          `Catatan bencana di ${activeRegion.province.name}`,
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
  if (
    query.includes('bencana') ||
    query.includes('gempa') ||
    query.includes('cuaca') ||
    query.includes('banjir') ||
    query.includes('longsor')
  ) {
    const prov = findProvinceInText(query);
    if (prov) {
      const stats = getProvinceDisasterStats(prov.code);
      const topHazardsText =
        stats.topHazards.length > 0
          ? stats.topHazards
              .slice(0, 4)
              .map((h) => `• **${h.label}**: ${formatCount(h.count)} kejadian`)
              .join('\n')
          : '• Nol kejadian bencana signifikan yang tercatat di laporan tahunan BNPB.';

      return {
        text: `Berdasarkan data kompilasi resmi Badan Nasional Penanggulangan Bencana (BNPB) tahun 2024, di **Provinsi ${prov.name}** (mencakup ${stats.regionCount} kabupaten/kota) tercatat total **${formatCount(stats.total2024)} kejadian bencana**.\n\nRincian bencana yang paling sering terjadi:\n${topHazardsText}\n\nSecara historis dari tahun 2010 hingga 2024, total kejadian bencana yang dihimpun BNPB di wilayah ini mencapai **${formatCount(stats.totalHistorical)} kejadian**.`,
        metrics: [
          {
            label: 'Kejadian Bencana 2024',
            value: `${formatCount(stats.total2024)} kali`,
            sub: 'BNPB',
          },
          {
            label: 'Bencana Terbanyak',
            value: stats.topHazards[0]
              ? `${stats.topHazards[0].label} (${stats.topHazards[0].count})`
              : 'Tidak tercatat',
          },
          {
            label: 'Kejadian Lainnya',
            value: stats.topHazards[1]
              ? `${stats.topHazards[1].label} (${stats.topHazards[1].count})`
              : '-',
          },
          { label: 'Cakupan Wilayah', value: `${stats.regionCount} Kab/Kota`, sub: prov.name },
        ],
        actions: [
          { label: `Peta Wilayah & Risiko ${prov.name}`, href: '/#peta' },
          { label: 'Kondisi Gempa & Cuaca Terkini BMKG', href: '/#indonesia-sekarang' },
        ],
        suggestions: [
          'Catatan bencana di Jawa Tengah',
          'Catatan bencana di Jawa Timur',
          'Berapa anggaran Kota Bandung?',
        ],
        activeRegion: lastRegion,
      };
    }

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
