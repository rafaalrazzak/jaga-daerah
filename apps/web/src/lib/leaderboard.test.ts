import { describe, expect, test } from 'bun:test';

import { compareMetric, formatRate, perTenThousand } from './leaderboard';

describe('perTenThousand', () => {
  test('turns an absolute count into a rate per 10,000 residents', () => {
    expect(perTenThousand(5, 100_000)).toBe(0.5);
    expect(perTenThousand(42, 2_100_000)).toBeCloseTo(0.2, 5);
  });

  test('returns null instead of zero when population is unavailable or empty', () => {
    expect(perTenThousand(5, null)).toBeNull();
    expect(perTenThousand(5, 0)).toBeNull();
  });
});

describe('compareMetric', () => {
  test('keeps missing values at the bottom in both directions', () => {
    expect(compareMetric(null, 3, true)).toBe(1);
    expect(compareMetric(3, null, true)).toBe(-1);
    expect(compareMetric(null, 3, false)).toBe(1);
    expect(compareMetric(3, null, false)).toBe(-1);
    expect(compareMetric(null, null, true)).toBe(0);
  });

  test('sorts present values by the requested direction', () => {
    expect(compareMetric(2, 5, true)).toBeGreaterThan(0);
    expect(compareMetric(2, 5, false)).toBeLessThan(0);
  });
});

describe('formatRate', () => {
  test('uses an Indonesian decimal comma and at most one decimal', () => {
    expect(formatRate(2.5)).toBe('2,5');
    expect(formatRate(3)).toBe('3');
  });
});
