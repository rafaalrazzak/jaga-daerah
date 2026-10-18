import { describe, expect, test } from 'bun:test';

import { buildNaturalResourceModule } from './natural-resources';

describe('buildNaturalResourceModule', () => {
  test('sums exactly, orders by realisation, and explains what the figure is not', () => {
    const module = buildNaturalResourceModule('Kabupaten Kutai Kartanegara', 2025, [
      {
        resourceType: 'gas_bumi',
        budgetAmount: '228290000000.00',
        realizationAmount: '228290000000.00',
      },
      {
        resourceType: 'minerba',
        budgetAmount: '4600020000000.00',
        realizationAmount: '4600020000000.00',
      },
      {
        resourceType: 'perikanan',
        budgetAmount: '1880000000.00',
        realizationAmount: '1880000000.00',
      },
      // Beyond Number.MAX_SAFE_INTEGER cents: must not lose precision.
      { resourceType: 'minyak_bumi', budgetAmount: '99999999999999.99', realizationAmount: '0.01' },
    ]);

    expect(module.status).toBe('complete');
    expect(module.by_type.map((row) => row.type)).toEqual([
      'minerba',
      'gas_bumi',
      'perikanan',
      'minyak_bumi',
    ]);
    expect(module.total_budget_amount).toBe('104830189999999.99');
    expect(module.total_realization_amount).toBe('4830190000000.01');
    expect(module.narrative[0]).toContain('realisasi terbesar dari mineral dan batubara');
    expect(module.narrative[1]).toContain('tidak menggambarkan besar kekayaan alam');
  });

  test('keeps blank amounts NULL and refuses a partial total', () => {
    const module = buildNaturalResourceModule('Kota Bandung', 2025, [
      { resourceType: 'panas_bumi', budgetAmount: '10.00', realizationAmount: null },
      { resourceType: 'gas_bumi', budgetAmount: '5.00', realizationAmount: '5.00' },
    ]);

    expect(module.status).toBe('partial');
    expect(module.total_budget_amount).toBe('15.00');
    expect(module.total_realization_amount).toBeNull();
    expect(module.by_type.at(-1)?.type).toBe('panas_bumi');
  });

  test('is unavailable without rows, with null totals rather than zero', () => {
    const module = buildNaturalResourceModule('Kota Bandung', 2025, []);

    expect(module).toMatchObject({
      status: 'unavailable',
      total_budget_amount: null,
      total_realization_amount: null,
      by_type: [],
    });
    expect(module.narrative[0]).toContain('tidak memuat dana bagi hasil sumber daya alam');
  });
});
