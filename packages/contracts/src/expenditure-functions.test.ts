import { describe, expect, test } from 'bun:test';

import { buildExpenditureFunctionModule } from './expenditure-functions';

describe('buildExpenditureFunctionModule', () => {
  test('shares the realisation total and treats a missing pagu as unknown, not zero', () => {
    const module = buildExpenditureFunctionModule('Kota Contoh', 2024, [
      { type: 'pendidikan', budgetAmount: null, realizationAmount: '30.00' },
      { type: 'kesehatan', budgetAmount: null, realizationAmount: '10.00' },
    ]);

    expect(module.status).toBe('partial');
    expect(module.total_budget_amount).toBeNull();
    expect(module.total_realization_amount).toBe('40.00');
    expect(module.by_function[0]).toMatchObject({
      type: 'pendidikan',
      realization_share_percent: '75.0',
      budget_share_percent: null,
    });
    expect(module.narrative[0]).toContain('75,0%');
    expect(module.narrative[1]).toContain('bukan pagu');
  });

  test('is unavailable when the source has no rows', () => {
    const module = buildExpenditureFunctionModule('Kota Contoh', 2024, []);
    expect(module.status).toBe('unavailable');
    expect(module.by_function).toEqual([]);
    expect(module.narrative[0]).toContain('tidak memuat');
  });

  test('is complete when every function has a realisation, including a reported zero', () => {
    const records = (
      [
        'pelayanan_umum',
        'ketertiban_dan_keamanan',
        'ekonomi',
        'perlindungan_lingkungan_hidup',
        'perumahan_dan_fasilitas_umum',
        'kesehatan',
        'pariwisata',
        'pendidikan',
        'perlindungan_sosial',
      ] as const
    ).map((type, index) => ({
      type,
      budgetAmount: null,
      realizationAmount: index === 0 ? '0.00' : '1.00',
    }));

    const module = buildExpenditureFunctionModule('Kota Contoh', 2024, records);
    expect(module.status).toBe('complete');
    expect(module.by_function).toHaveLength(9);
    expect(module.by_function.at(-1)?.realization_amount).toBe('0.00');
  });
});
