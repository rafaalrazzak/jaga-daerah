import type { MedianComparison } from '@jaga-daerah/contracts';

const RUPIAH_PATTERN = /^(\d+)\.(\d{2})$/;
const PERCENT_PATTERN = /^(\d+)\.(\d)$/;

/** Exact cents from a numeric(20,2) decimal string; never goes through a float. */
export function toCents(amount: string): bigint {
  const match = RUPIAH_PATTERN.exec(amount);
  if (match === null) {
    throw new Error(`Not a rupiah decimal string: ${amount}`);
  }
  return BigInt(match[1] ?? '0') * 100n + BigInt(match[2] ?? '0');
}

/**
 * Realisation as a percent of budget, one decimal place, rounded half up, computed with integer
 * arithmetic. NULL when either side is unavailable or the budget is zero ("data tidak cukup").
 */
export function realizationPercent(
  budget: string | null,
  realization: string | null,
): string | null {
  if (budget === null || realization === null) {
    return null;
  }
  const budgetCents = toCents(budget);
  if (budgetCents === 0n) {
    return null;
  }
  // tenths of a percent = realization / budget * 1000, rounded half up.
  const tenths = (toCents(realization) * 2000n + budgetCents) / (budgetCents * 2n);
  return `${tenths / 10n}.${tenths % 10n}`;
}

export function toTenths(percent: string): bigint {
  const match = PERCENT_PATTERN.exec(percent);
  if (match === null) {
    throw new Error(`Not a one-decimal percent: ${percent}`);
  }
  return BigInt(match[1] ?? '0') * 10n + BigInt(match[2] ?? '0');
}

export function compareWithMedian(
  percent: string | null,
  median: string | null,
): MedianComparison | null {
  if (percent === null || median === null) {
    return null;
  }
  const difference = toTenths(percent) - toTenths(median);
  if (difference > 0n) return 'above';
  if (difference < 0n) return 'below';
  return 'equal';
}

/** "89.8" → "89,8" (Indonesian decimal comma). */
export function formatPercentId(percent: string): string {
  return percent.replace('.', ',');
}
