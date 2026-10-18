import { describe, expect, test } from 'bun:test';

import { EXPENDITURE_FUNCTIONS } from './expenditure-functions';

describe('expenditure function artifact', () => {
  test('keeps Kota Bandung education as the sum of the plain and tagging lines', () => {
    const rows = EXPENDITURE_FUNCTIONS.regions['32.73'];
    expect(rows).toBeDefined();
    const pendidikan = rows?.find((row) => row.type === 'pendidikan');
    expect(pendidikan?.realization_amount).toBe('1850471261043.00');
    expect(EXPENDITURE_FUNCTIONS.year).toBe(2024);
    expect(EXPENDITURE_FUNCTIONS.source.url).toContain('31102025_Realisasi_Belanja_Daerah_2024');
  });
});
