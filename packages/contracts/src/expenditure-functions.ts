import { z } from 'zod';

import {
  ExpenditureFunctionSchema,
  RupiahSchema,
  type ExpenditureFunction,
  type ExpenditureFunctionModule,
} from './profile';

// Public labels for the nine DJPK functions. Tagging lines for kesehatan and pendidikan are
// summed into those two before they reach this contract.
export const EXPENDITURE_FUNCTION_LABELS = {
  pelayanan_umum: 'Pelayanan umum',
  ketertiban_dan_keamanan: 'Ketertiban dan keamanan',
  ekonomi: 'Ekonomi',
  perlindungan_lingkungan_hidup: 'Perlindungan lingkungan hidup',
  perumahan_dan_fasilitas_umum: 'Perumahan dan fasilitas umum',
  kesehatan: 'Kesehatan',
  pariwisata: 'Pariwisata',
  pendidikan: 'Pendidikan',
  perlindungan_sosial: 'Perlindungan sosial',
} as const satisfies Record<ExpenditureFunction, string>;

const FUNCTION_FILE_REGION = z.string().regex(/^[0-9]{2}\.[0-9]{2}$/);

export const ExpenditureFunctionFileSchema = z.object({
  year: z.number().int(),
  source: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    page: z.url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    downloaded_at: z.iso.datetime({ offset: true }),
  }),
  labels: z.record(ExpenditureFunctionSchema, z.string().min(1)),
  note: z.string().min(1),
  regions: z.record(
    FUNCTION_FILE_REGION,
    z.array(
      z.object({
        type: ExpenditureFunctionSchema,
        realization_amount: RupiahSchema,
      }),
    ),
  ),
});

export type ExpenditureFunctionFile = z.infer<typeof ExpenditureFunctionFileSchema>;

export interface ExpenditureFunctionRecord {
  type: string;
  budgetAmount: string | null;
  realizationAmount: string | null;
}

const FUNCTION_COUNT = Object.keys(EXPENDITURE_FUNCTION_LABELS).length;
const MEANING =
  'Ini realisasi menurut fungsi (urusan) belanja, bukan pagu anggaran dan bukan rincian per program atau dinas. Baris DJPK "Kesehatan Tagging" dan "Pendidikan Tagging" sudah dijumlahkan ke fungsi kesehatan dan pendidikan.';

function toCents(amount: string): bigint {
  const [whole, fraction] = amount.split('.');
  return BigInt(whole ?? '0') * 100n + BigInt(fraction ?? '0');
}

function fromCents(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

function total(values: (string | null)[]): string | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return fromCents(values.reduce((sum, value) => sum + toCents(value ?? '0.00'), 0n));
}

/** One-decimal share, half up, matching the jenis-belanja module. NULL when the whole is 0. */
function sharePercent(amount: string | null, whole: string | null): string | null {
  if (amount === null || whole === null) return null;
  const wholeCents = toCents(whole);
  if (wholeCents === 0n) return null;
  const tenths = (toCents(amount) * 2000n + wholeCents) / (wholeCents * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
}

function isFunction(value: string): value is ExpenditureFunction {
  return value in EXPENDITURE_FUNCTION_LABELS;
}

export function buildExpenditureFunctionModule(
  regionName: string,
  year: number,
  records: ExpenditureFunctionRecord[],
): ExpenditureFunctionModule {
  const known = records.filter(
    (record): record is ExpenditureFunctionRecord & { type: ExpenditureFunction } =>
      isFunction(record.type),
  );
  const realizationTotal = total(known.map((record) => record.realizationAmount));
  const budgetTotal = total(known.map((record) => record.budgetAmount));
  const rows = known
    .map((record) => ({
      type: record.type,
      label: EXPENDITURE_FUNCTION_LABELS[record.type],
      budget_amount: record.budgetAmount,
      realization_amount: record.realizationAmount,
      budget_share_percent: sharePercent(record.budgetAmount, budgetTotal),
      realization_share_percent: sharePercent(record.realizationAmount, realizationTotal),
    }))
    .toSorted((left, right) => {
      if (left.realization_amount === null || right.realization_amount === null) {
        if (left.realization_amount !== right.realization_amount) {
          return left.realization_amount === null ? 1 : -1;
        }
        return left.label.localeCompare(right.label, 'id');
      }
      const difference = toCents(right.realization_amount) - toCents(left.realization_amount);
      if (difference === 0n) return left.label.localeCompare(right.label, 'id');
      return difference > 0n ? 1 : -1;
    });

  if (rows.length === 0) {
    return {
      year,
      status: 'unavailable',
      total_budget_amount: null,
      total_realization_amount: null,
      by_function: [],
      narrative: [
        `Data DJPK tahun ${year} tidak memuat realisasi belanja menurut fungsi untuk ${regionName}.`,
        MEANING,
      ],
    };
  }

  const blanks = known.some((record) => record.realizationAmount === null);
  const status = blanks || known.length < FUNCTION_COUNT ? 'partial' : 'complete';
  const featured = rows.find((row) => row.realization_share_percent !== null);
  const share = featured?.realization_share_percent ?? null;
  const lead =
    featured === undefined || share === null
      ? `Pada tahun ${year}, ${rows.length} fungsi belanja ${regionName} tercatat pada data DJPK.`
      : `Pada tahun ${year}, realisasi belanja ${regionName} tersebar di ${rows.length} fungsi. Bagian terbesar adalah ${featured.label}, ${share.replace('.', ',')}% dari jumlah fungsi ini.`;

  return {
    year,
    status,
    total_budget_amount: budgetTotal,
    total_realization_amount: realizationTotal,
    by_function: rows,
    narrative: [lead, MEANING],
  };
}
