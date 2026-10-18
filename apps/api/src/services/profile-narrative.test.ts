import { describe, expect, test } from 'bun:test';

import { budgetNarrative } from './profile-narrative';

const BASE = { regionName: 'Kota Bandung', year: 2025 } as const;

describe('budgetNarrative', () => {
  test('explains realisation per Rp100 ribu and compares with the national median', () => {
    expect(
      budgetNarrative({
        ...BASE,
        status: 'complete',
        realizationPercent: '89.8',
        nationalMedianPercent: '93.4',
        comparison: 'below',
      }),
    ).toEqual([
      'Dari setiap Rp100 ribu anggaran belanja Kota Bandung tahun 2025, sekitar Rp89,8 ribu tercatat sudah direalisasikan.',
      'Persentase ini di bawah median nasional kabupaten/kota pada tahun yang sama (93,4%).',
    ]);
  });

  test('states over-realisation as a percentage without judgement', () => {
    const [sentence] = budgetNarrative({
      ...BASE,
      status: 'complete',
      realizationPercent: '101.9',
      nationalMedianPercent: null,
      comparison: null,
    });

    expect(sentence).toBe(
      'Realisasi belanja Kota Bandung tahun 2025 tercatat 101,9% dari anggaran, melebihi nilai yang dianggarkan.',
    );
  });

  test('says data is incomplete instead of inventing a percentage', () => {
    expect(
      budgetNarrative({
        ...BASE,
        status: 'partial',
        realizationPercent: null,
        nationalMedianPercent: '90.0',
        comparison: null,
      }),
    ).toEqual([
      'Data anggaran atau realisasi belanja Kota Bandung tahun 2025 belum lengkap, sehingga persentase realisasi belum dapat dihitung.',
    ]);
  });

  test('says data is unavailable', () => {
    expect(
      budgetNarrative({
        ...BASE,
        status: 'unavailable',
        realizationPercent: null,
        nationalMedianPercent: null,
        comparison: null,
      }),
    ).toEqual(['Data APBD Kota Bandung tahun 2025 belum tersedia di sumber DJPK.']);
  });

  test.each(['gagal', 'korupsi', 'buruk', 'lalai'])(
    'never uses accusatory wording (%s)',
    (word) => {
      const text = budgetNarrative({
        ...BASE,
        status: 'complete',
        realizationPercent: '12.3',
        nationalMedianPercent: '90.0',
        comparison: 'below',
      }).join(' ');

      expect(text.toLowerCase()).not.toContain(word);
    },
  );
});
