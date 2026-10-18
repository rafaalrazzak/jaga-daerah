import type {
  DataStatus,
  NaturalResourceModule,
  NaturalResourceType,
} from '@jaga-daerah/contracts';

import type { NaturalResourceRecord } from '#api/repositories/profile-repository';
import { toCents } from '#api/services/budget-metrics';

export const NATURAL_RESOURCE_LABELS: Record<NaturalResourceType, string> = {
  minyak_bumi: 'Minyak bumi',
  gas_bumi: 'Gas bumi',
  minerba: 'Mineral dan batubara',
  kehutanan: 'Kehutanan',
  perikanan: 'Perikanan',
  panas_bumi: 'Panas bumi',
  perkebunan_sawit: 'Perkebunan sawit',
};

function isNaturalResourceType(value: string): value is NaturalResourceType {
  return value in NATURAL_RESOURCE_LABELS;
}

function fromCents(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

/** Exact sum of rupiah strings; NULL when there is nothing to sum or any value is unknown. */
function total(values: (string | null)[]): string | null {
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return fromCents(values.reduce((sum, value) => sum + toCents(value ?? '0.00'), 0n));
}

function status(records: NaturalResourceRecord[]): DataStatus {
  if (records.length === 0) return 'unavailable';
  const blanks = records.some(
    (record) => record.budgetAmount === null || record.realizationAmount === null,
  );
  return blanks ? 'partial' : 'complete';
}

function narrative(
  regionName: string,
  year: number,
  rows: NaturalResourceModule['by_type'],
): string[] {
  const caveat =
    'Dana ini dibagikan pemerintah pusat menurut rumus undang-undang dari penerimaan negara atas sumber daya alam, termasuk ke daerah yang bukan penghasil. Angkanya tidak menggambarkan besar kekayaan alam daerah.';
  if (rows.length === 0) {
    return [
      `Data TKDD DJPK tahun ${year} tidak memuat dana bagi hasil sumber daya alam untuk ${regionName}.`,
      caveat,
    ];
  }
  const largest = rows.find(
    (row) => row.realization_amount !== null && row.realization_amount !== '0.00',
  );
  return [
    largest === undefined
      ? `Pada tahun ${year}, ${regionName} tercatat dalam ${rows.length} jenis dana bagi hasil sumber daya alam, belum ada realisasi yang tercatat.`
      : `Pada tahun ${year}, ${regionName} tercatat menerima dana bagi hasil dari ${rows.length} jenis sumber daya alam; realisasi terbesar dari ${largest.label.toLowerCase()}.`,
    caveat,
  ];
}

export function buildNaturalResourceModule(
  regionName: string,
  year: number,
  records: NaturalResourceRecord[],
): NaturalResourceModule {
  const known = records.filter(
    (record): record is NaturalResourceRecord & { resourceType: NaturalResourceType } =>
      isNaturalResourceType(record.resourceType),
  );
  const rows = known
    .map((record) => ({
      type: record.resourceType,
      label: NATURAL_RESOURCE_LABELS[record.resourceType],
      budget_amount: record.budgetAmount,
      realization_amount: record.realizationAmount,
    }))
    // Largest realisation first; unknown amounts last, then by label for a stable order.
    .toSorted((a, b) => {
      if (a.realization_amount === null || b.realization_amount === null) {
        if (a.realization_amount !== b.realization_amount)
          return a.realization_amount === null ? 1 : -1;
        return a.label.localeCompare(b.label, 'id');
      }
      const difference = toCents(b.realization_amount) - toCents(a.realization_amount);
      return difference === 0n ? a.label.localeCompare(b.label, 'id') : difference > 0n ? 1 : -1;
    });

  return {
    status: status(known),
    total_budget_amount: total(rows.map((row) => row.budget_amount)),
    total_realization_amount: total(rows.map((row) => row.realization_amount)),
    by_type: rows,
    narrative: narrative(regionName, year, rows),
  };
}
