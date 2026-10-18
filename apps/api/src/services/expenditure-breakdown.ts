import type {
  DataStatus,
  ExpenditureBreakdownModule,
  ExpenditureType,
} from '@jaga-daerah/contracts';

import type { ExpenditureRecord } from '#api/repositories/profile-repository';
import { toCents } from '#api/services/budget-metrics';

export const EXPENDITURE_LABELS: Record<ExpenditureType, string> = {
  belanja_pegawai: 'Belanja pegawai',
  belanja_barang_dan_jasa: 'Belanja barang dan jasa',
  belanja_modal: 'Belanja modal',
  belanja_bunga: 'Belanja bunga',
  belanja_subsidi: 'Belanja subsidi',
  belanja_hibah: 'Belanja hibah',
  belanja_bantuan_sosial: 'Belanja bantuan sosial',
  belanja_bagi_hasil: 'Belanja bagi hasil',
  belanja_bantuan_keuangan: 'Belanja bantuan keuangan',
  belanja_tidak_terduga: 'Belanja tidak terduga',
};

function isExpenditureType(value: string): value is ExpenditureType {
  return value in EXPENDITURE_LABELS;
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

/** One-decimal percentage with exact integer arithmetic; NULL when the total is unknown or zero. */
function sharePercent(amount: string | null, whole: string | null): string | null {
  if (amount === null || whole === null) return null;
  const wholeCents = toCents(whole);
  if (wholeCents === 0n) return null;
  const tenths = (toCents(amount) * 2000n + wholeCents) / (wholeCents * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** The partition is whole only when every stored row is a recognised jenis with both amounts. */
function status(known: ExpenditureRecord[], dropped: number): DataStatus {
  if (known.length === 0) return 'unavailable';
  if (dropped > 0) return 'partial';
  const blanks = known.some(
    (record) => record.budgetAmount === null || record.realizationAmount === null,
  );
  return blanks ? 'partial' : 'complete';
}

/** The ten APBD jenis belanja are the only classification here; DJPK's "Belanja Lainnya" is an
 * aggregate of seven of them and is not stored, so any row outside the enum is dropped and the
 * status becomes partial rather than silently shrinking the partition. */
function narrative(
  regionName: string,
  year: number,
  rows: ExpenditureBreakdownModule['by_type'],
  knownCount: number,
): string[] {
  const meaning =
    'Rincian ini memakai klasifikasi baku APBD menurut jenis belanja (misalnya belanja pegawai, barang dan jasa, modal). Rincian ini bukan belanja per program atau per dinas, sehingga tidak dapat dipakai untuk menilai satu kegiatan tertentu.';
  if (rows.length === 0) {
    return [
      `Data DJPK tahun ${year} tidak memuat rincian belanja menurut jenis untuk ${regionName}.`,
      meaning,
    ];
  }
  const complete = knownCount === Object.keys(EXPENDITURE_LABELS).length;
  return [
    complete
      ? `Pada tahun ${year}, belanja daerah ${regionName} terbagi ke ${rows.length} jenis belanja menurut klasifikasi APBD; jumlah seluruh jenis sama dengan total belanja daerah yang dipublikasikan.`
      : `Pada tahun ${year}, ${rows.length} jenis belanja ${regionName} tercatat pada data DJPK; jenis yang tidak dilaporkan sumber ditampilkan sebagai "Data belum tersedia".`,
    meaning,
  ];
}

export function buildExpenditureBreakdownModule(
  regionName: string,
  year: number,
  records: ExpenditureRecord[],
  parentBudget: string | null,
  parentRealization: string | null,
): ExpenditureBreakdownModule {
  const known = records.filter(
    (record): record is ExpenditureRecord & { expenditureType: ExpenditureType } =>
      isExpenditureType(record.expenditureType),
  );
  // The published Belanja Daerah total is the reconciliation reference; the module totals sum the
  // jenis rows so a reader can compare the two figures directly.
  const rows = known
    .map((record) => ({
      type: record.expenditureType,
      label: EXPENDITURE_LABELS[record.expenditureType],
      budget_amount: record.budgetAmount,
      realization_amount: record.realizationAmount,
      budget_share_percent: sharePercent(record.budgetAmount, parentBudget),
      realization_share_percent: sharePercent(record.realizationAmount, parentRealization),
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
    status: status(known, records.length - known.length),
    total_budget_amount: total(rows.map((row) => row.budget_amount)),
    total_realization_amount: total(rows.map((row) => row.realization_amount)),
    by_type: rows,
    narrative: narrative(regionName, year, rows, known.length),
  };
}
