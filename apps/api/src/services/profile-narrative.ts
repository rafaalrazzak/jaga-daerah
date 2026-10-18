import type { DataStatus, MedianComparison } from '@jaga-daerah/contracts';

import { formatPercentId, toTenths } from '#api/services/budget-metrics';

export interface BudgetNarrativeInput {
  regionName: string;
  year: number;
  status: DataStatus;
  realizationPercent: string | null;
  nationalMedianPercent: string | null;
  comparison: MedianComparison | null;
}

const COMPARISON_PHRASE: Record<MedianComparison, string> = {
  above: 'di atas',
  below: 'di bawah',
  equal: 'sama dengan',
};

/**
 * Deterministic, neutral sentences from fixed templates (PRD §7.3, §7.5). States what the data
 * shows; never infers causes or judges the local government.
 */
export function budgetNarrative(input: BudgetNarrativeInput): string[] {
  const { regionName, year } = input;

  if (input.status === 'unavailable') {
    return [`Data APBD ${regionName} tahun ${year} belum tersedia di sumber DJPK.`];
  }
  if (input.realizationPercent === null) {
    return [
      `Data anggaran atau realisasi belanja ${regionName} tahun ${year} belum lengkap, sehingga persentase realisasi belum dapat dihitung.`,
    ];
  }

  const percent = formatPercentId(input.realizationPercent);
  const ONE_HUNDRED_PERCENT_IN_TENTHS = 1000n;
  const sentences = [
    toTenths(input.realizationPercent) <= ONE_HUNDRED_PERCENT_IN_TENTHS
      ? `Dari setiap Rp100 ribu anggaran belanja ${regionName} tahun ${year}, sekitar Rp${percent} ribu tercatat sudah direalisasikan.`
      : `Realisasi belanja ${regionName} tahun ${year} tercatat ${percent}% dari anggaran, melebihi nilai yang dianggarkan.`,
  ];

  if (input.comparison !== null && input.nationalMedianPercent !== null) {
    sentences.push(
      `Persentase ini ${COMPARISON_PHRASE[input.comparison]} median nasional kabupaten/kota pada tahun yang sama (${formatPercentId(input.nationalMedianPercent)}%).`,
    );
  }
  return sentences;
}
