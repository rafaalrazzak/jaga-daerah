import { describe, expect, test } from 'bun:test';

import { buildExpenditureBreakdownModule } from './expenditure-breakdown';

const PARENT_BUDGET = '1000.00';
const PARENT_REALIZATION = '800.00';

describe('buildExpenditureBreakdownModule', () => {
  test('sums the jenis rows and reports each share of the published total exactly', () => {
    const module = buildExpenditureBreakdownModule(
      'Kota Bandung',
      2025,
      [
        { expenditureType: 'belanja_pegawai', budgetAmount: '600.00', realizationAmount: '500.00' },
        { expenditureType: 'belanja_modal', budgetAmount: '400.00', realizationAmount: '300.00' },
      ],
      PARENT_BUDGET,
      PARENT_REALIZATION,
    );

    expect(module.status).toBe('complete');
    expect(module.total_budget_amount).toBe('1000.00');
    expect(module.total_realization_amount).toBe('800.00');
    expect(module.by_type).toEqual([
      {
        type: 'belanja_pegawai',
        label: 'Belanja pegawai',
        budget_amount: '600.00',
        realization_amount: '500.00',
        budget_share_percent: '60.0',
        realization_share_percent: '62.5',
      },
      {
        type: 'belanja_modal',
        label: 'Belanja modal',
        budget_amount: '400.00',
        realization_amount: '300.00',
        budget_share_percent: '40.0',
        realization_share_percent: '37.5',
      },
    ]);
  });

  test('keeps a blank jenis amount as NULL and marks the module partial', () => {
    const module = buildExpenditureBreakdownModule(
      'Kota Bandung',
      2025,
      [{ expenditureType: 'belanja_pegawai', budgetAmount: '600.00', realizationAmount: null }],
      PARENT_BUDGET,
      PARENT_REALIZATION,
    );

    expect(module.status).toBe('partial');
    expect(module.by_type[0]?.realization_amount).toBeNull();
    expect(module.by_type[0]?.realization_share_percent).toBeNull();
    // A partial partition must not publish a "total" that looks complete.
    expect(module.total_budget_amount).toBe('600.00');
    expect(module.total_realization_amount).toBeNull();
  });

  test('reports an explicit zero distinctly from unavailable', () => {
    const module = buildExpenditureBreakdownModule(
      'Kota Bandung',
      2025,
      [{ expenditureType: 'belanja_subsidi', budgetAmount: '0.00', realizationAmount: '0.00' }],
      '0.00',
      '0.00',
    );

    expect(module.status).toBe('complete');
    expect(module.by_type[0]?.budget_amount).toBe('0.00');
    // The parent total is zero, so a share is "data tidak cukup", not 0%.
    expect(module.by_type[0]?.budget_share_percent).toBeNull();
  });

  test('drops an unknown jenis and degrades to partial rather than shrinking silently', () => {
    const module = buildExpenditureBreakdownModule(
      'Kota Bandung',
      2025,
      [
        { expenditureType: 'belanja_pegawai', budgetAmount: '600.00', realizationAmount: '500.00' },
        { expenditureType: 'belanja_lainnya', budgetAmount: '400.00', realizationAmount: '300.00' },
      ],
      PARENT_BUDGET,
      PARENT_REALIZATION,
    );

    expect(module.by_type).toHaveLength(1);
    expect(module.status).toBe('partial');
  });

  test('handles a region with no breakdown rows at all', () => {
    const module = buildExpenditureBreakdownModule('Kota Bandung', 2025, [], null, null);

    expect(module.status).toBe('unavailable');
    expect(module.by_type).toEqual([]);
    expect(module.total_budget_amount).toBeNull();
    expect(module.narrative).toHaveLength(2);
  });

  test('orders rows by largest realisation with unknown amounts last', () => {
    const module = buildExpenditureBreakdownModule(
      'Kota Bandung',
      2025,
      [
        { expenditureType: 'belanja_modal', budgetAmount: '100.00', realizationAmount: null },
        { expenditureType: 'belanja_pegawai', budgetAmount: '100.00', realizationAmount: '10.00' },
        { expenditureType: 'belanja_hibah', budgetAmount: '100.00', realizationAmount: '90.00' },
      ],
      PARENT_BUDGET,
      PARENT_REALIZATION,
    );

    expect(module.by_type.map((row) => row.type)).toEqual([
      'belanja_hibah',
      'belanja_pegawai',
      'belanja_modal',
    ]);
  });

  test('keeps large rupiah values exact without float loss', () => {
    const module = buildExpenditureBreakdownModule(
      'Kota Bandung',
      2025,
      [
        {
          expenditureType: 'belanja_pegawai',
          budgetAmount: '2884410615525.00',
          realizationAmount: '2739791512799.10',
        },
      ],
      '2884410615525.00',
      '2739791512799.10',
    );

    expect(module.total_budget_amount).toBe('2884410615525.00');
    expect(module.by_type[0]?.budget_share_percent).toBe('100.0');
  });
});
