import { describe, expect, test } from 'bun:test';

import { formatCount, formatPercent, formatRupiahFull, formatRupiahShort } from './format';

describe('rupiah formatting', () => {
  test.each([
    ['8345231335444.90', 'Rp8,35 triliun', 'Rp8.345.231.335.444,90'],
    ['1476360993273.00', 'Rp1,48 triliun', 'Rp1.476.360.993.273,00'],
    ['999999999.99', 'Rp1,00 miliar', 'Rp999.999.999,99'],
    ['1500000000.00', 'Rp1,50 miliar', 'Rp1.500.000.000,00'],
    ['950.00', 'Rp950', 'Rp950,00'],
    ['0.00', 'Rp0', 'Rp0,00'],
  ])('%s → %s / %s', (amount, short, full) => {
    expect(formatRupiahShort(amount)).toBe(short);
    expect(formatRupiahFull(amount)).toBe(full);
  });

  test('keeps every digit of values beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatRupiahFull('99999999999999999.99')).toBe('Rp99.999.999.999.999.999,99');
  });

  test('rejects non-decimal input instead of guessing', () => {
    expect(() => formatRupiahFull('1e12')).toThrow();
  });
});

test('percent and counts use Indonesian separators', () => {
  expect(formatPercent('89.8')).toBe('89,8%');
  expect(formatCount(776258)).toBe('776.258');
});
