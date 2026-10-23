// Ranking helpers for the leaderboard. Absolute facility counts favour large regions, so the page
// also offers a rate per 10,000 residents; population comes from Dukcapil 31 December 2024.

export type LeaderboardBasis = 'total' | 'per-10000';

const RATE_FORMAT = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function perTenThousand(total: number, population: number | null): number | null {
  if (population === null || population <= 0) return null;
  return (total / population) * 10_000;
}

export function formatRate(value: number): string {
  return RATE_FORMAT.format(value);
}

/** Ascending/descending order, always keeping regions without a value at the bottom. */
export function compareMetric(
  left: number | null,
  right: number | null,
  descending: boolean,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}
