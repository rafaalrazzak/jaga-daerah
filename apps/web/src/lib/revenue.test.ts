import { describe, expect, test } from 'bun:test';

import { REVENUE } from './revenue';

describe('revenue artifact', () => {
  test('keeps Kota Bandung 2024 realization as the sum of the revenue lines', () => {
    const record = REVENUE.regions['32.73'];
    expect(record?.total_amount).toBe('7153103797809.90');
    expect(record?.rows.map((row) => row.type)).toContain('pajak_daerah');
    expect(REVENUE.year).toBe(2024);
    expect(REVENUE.note).toContain('bukan penghasilan warga');
  });
});
