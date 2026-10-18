import { describe, expect, test } from 'bun:test';

import { LAND_COVER } from './land-cover';

describe('land cover artifact', () => {
  test('stores Aceh 2023 classes as hectares at province level', () => {
    const aceh = LAND_COVER.provinces['11'];
    expect(aceh?.rows.find((row) => row.class === 'hutan_primer')?.hectares).toBe('1934600.00');
    expect(LAND_COVER.year).toBe(2023);
    expect(LAND_COVER.level).toBe('provinsi');
    expect(LAND_COVER.note).toContain('bukan daftar spesies');
  });
});
