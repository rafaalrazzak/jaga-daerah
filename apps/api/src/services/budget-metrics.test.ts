import { describe, expect, test } from 'bun:test';

import { compareWithMedian, realizationPercent, toCents } from './budget-metrics';

describe('realizationPercent', () => {
  test.each([
    ['8345231335444.90', '7490617461211.10', '89.8'],
    ['100.00', '100.00', '100.0'],
    ['1317952493749.00', '1342398868864.30', '101.9'],
    ['1000.00', '0.00', '0.0'],
    // 2/3 = 66.666… → 66.7 (half up on the hundredths)
    ['3.00', '2.00', '66.7'],
    // exactly 12.25% rounds half up to 12.3
    ['400.00', '49.00', '12.3'],
  ])('budget %s, realisation %s → %s%%', (budget, realization, expected) => {
    expect(realizationPercent(budget, realization)).toBe(expected);
  });

  test('keeps precision for values beyond Number.MAX_SAFE_INTEGER', () => {
    expect(toCents('99999999999999999.99')).toBe(9_999_999_999_999_999_999n);
    expect(realizationPercent('99999999999999999.99', '99999999999999999.98')).toBe('100.0');
  });

  test('returns null instead of 0% when data is missing or the budget is zero', () => {
    expect(realizationPercent(null, '1.00')).toBeNull();
    expect(realizationPercent('1.00', null)).toBeNull();
    expect(realizationPercent('0.00', '5.00')).toBeNull();
  });

  test('rejects strings that are not numeric(20,2) decimals', () => {
    expect(() => realizationPercent('1e6', '1.00')).toThrow();
  });
});

describe('compareWithMedian', () => {
  test.each([
    ['89.8', '89.7', 'above'],
    ['89.7', '89.8', 'below'],
    ['89.8', '89.8', 'equal'],
  ] as const)('%s vs median %s → %s', (percent, median, expected) => {
    expect(compareWithMedian(percent, median)).toBe(expected);
  });

  test('is null when either side is unavailable', () => {
    expect(compareWithMedian(null, '50.0')).toBeNull();
    expect(compareWithMedian('50.0', null)).toBeNull();
  });
});
