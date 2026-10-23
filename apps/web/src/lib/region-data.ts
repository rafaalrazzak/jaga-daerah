// Export helpers for the "Unduh & kutip" panel. Everything here is pure so the CSV and citation
// are covered by unit tests; the browser download itself lives in `downloadTextFile`.
//
// Rupiah values stay as the decimal strings the API returned: JavaScript numbers would silently
// round budgets above 2^53 (AGENTS.md).

import type { RegionProfile } from '@jaga-daerah/contracts';

export interface RegionExportContext {
  datasetVersion: string | null;
  /** The page URL the reader is looking at, including the selected year. */
  downloadedFrom: string;
  /** ISO timestamp of the export. */
  exportedAt: string;
}

const CSV_HEADER = [
  'tahun',
  'kelompok',
  'jenis',
  'anggaran',
  'realisasi',
  'persen_anggaran',
  'persen_realisasi',
  'satuan',
  'tingkat',
  'keterangan',
] as const;

type CsvCell = string | number | null | undefined;

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rupiahRows(
  profile: RegionProfile,
  group: string,
  rows: readonly {
    label: string;
    budget_amount: string | null;
    realization_amount: string | null;
    budget_share_percent?: string | null;
    realization_share_percent?: string | null;
  }[],
  level: string,
): CsvCell[][] {
  return rows.map((row) => [
    profile.year,
    group,
    row.label,
    row.budget_amount,
    row.realization_amount,
    row.budget_share_percent ?? null,
    row.realization_share_percent ?? null,
    'rupiah',
    level,
    null,
  ]);
}

export function buildRegionCsv(profile: RegionProfile): string {
  const budget = profile.budget;
  const rows: CsvCell[][] = [
    [
      profile.year,
      'Anggaran',
      'Total anggaran',
      budget.budget_amount,
      null,
      null,
      null,
      'rupiah',
      'kabupaten/kota',
      null,
    ],
    [
      profile.year,
      'Anggaran',
      'Total realisasi',
      null,
      budget.realization_amount,
      null,
      null,
      'rupiah',
      'kabupaten/kota',
      null,
    ],
    [
      profile.year,
      'Anggaran',
      'Persentase realisasi',
      null,
      null,
      null,
      budget.realization_percent,
      'persen',
      'kabupaten/kota',
      budget.status,
    ],
    ...rupiahRows(
      profile,
      'Belanja menurut jenis',
      profile.expenditure_breakdown.by_type,
      'kabupaten/kota',
    ),
    ...profile.expenditure_by_function.by_function.map((row) => [
      profile.expenditure_by_function.year,
      'Belanja menurut fungsi',
      row.label,
      row.budget_amount,
      row.realization_amount,
      row.budget_share_percent,
      row.realization_share_percent,
      'rupiah',
      'kabupaten/kota',
      null,
    ]),
    ...rupiahRows(
      profile,
      'Dana bagi hasil SDA',
      profile.natural_resources.by_type,
      'kabupaten/kota',
    ),
    [
      profile.year,
      'Bencana',
      'Jumlah kejadian',
      null,
      null,
      null,
      null,
      'kejadian',
      'provinsi',
      profile.disaster.province.name,
    ],
    [
      profile.year,
      'Bencana',
      'Korban meninggal',
      null,
      null,
      null,
      null,
      'jiwa',
      'provinsi',
      profile.disaster.province.name,
    ],
    [
      profile.year,
      'Bencana',
      'Korban hilang',
      null,
      null,
      null,
      null,
      'jiwa',
      'provinsi',
      profile.disaster.province.name,
    ],
    [
      profile.year,
      'Bencana',
      'Korban terdampak',
      null,
      null,
      null,
      null,
      'jiwa',
      'provinsi',
      profile.disaster.province.name,
    ],
    ...profile.disaster.by_type.map((row) => [
      profile.year,
      'Bencana menurut jenis',
      row.label,
      null,
      null,
      null,
      null,
      'kejadian',
      'provinsi',
      `${profile.disaster.province.name}; meninggal ${row.deaths ?? ''}; hilang ${row.missing ?? ''}; terdampak ${row.affected ?? ''}`,
    ]),
    ...profile.sources.map((source) => [
      profile.year,
      'Sumber',
      source.publisher,
      null,
      null,
      null,
      null,
      null,
      'nasional',
      `${source.title}; ${source.source_url}; periode ${source.period}; diunduh ${source.downloaded_at}`,
    ]),
  ];

  const lines = [CSV_HEADER.join(','), ...rows.map((row) => row.map(csvCell).join(','))];
  // BOM so Excel reads Indonesian characters correctly.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function buildRegionJson(profile: RegionProfile, context: RegionExportContext): string {
  return JSON.stringify(
    {
      citation: buildCitation(profile, context.downloadedFrom, new Date(context.exportedAt)),
      downloaded_from: context.downloadedFrom,
      exported_at: context.exportedAt,
      dataset_version: context.datasetVersion,
      ...profile,
    },
    null,
    2,
  );
}

const DATE_FORMAT = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jakarta',
});

export function buildCitation(profile: RegionProfile, url: string, accessedAt: Date): string {
  const publishers = [...new Set(profile.sources.map((source) => source.publisher))].join('; ');
  const accessed = DATE_FORMAT.format(accessedAt);
  return `JagaDaerah. Profil ${profile.region.name}, Provinsi ${profile.region.province.name}, tahun ${profile.year}. ${url} (diakses ${accessed}). Sumber data: ${publishers}.`;
}

export function regionExportFilename(
  slug: string,
  year: number,
  extension: 'json' | 'csv',
): string {
  return `jaga-daerah-${slug}-${year}.${extension}`;
}

/** Trigger a client-side download. Only call from a browser event handler. */
export function downloadTextFile(filename: string, mimeType: string, text: string): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
