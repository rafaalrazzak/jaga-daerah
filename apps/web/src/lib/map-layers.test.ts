import { describe, expect, test } from 'bun:test';

import { ELECTRIFICATION, electrificationClass, formatRatio } from './map-layers';
import { countScale, placeSnapshot, provinceQuantityScale, spreadReading } from './map-layers';

describe('countScale', () => {
  test('splits ranked counts into five groups and keeps gaps empty', () => {
    const scale = countScale([1, 2, 3, 4, 10, null]);
    expect(scale.classify(null)).toBe('none');
    expect(scale.classify(1)).toBe('far-below');
    expect(scale.classify(10)).toBe('far-above');
    expect(scale.bands.map((band) => band.key)).toContain('far-below');
    expect(scale.bands.find((band) => band.key === 'far-above')).toEqual({
      key: 'far-above',
      min: 10,
      max: 10,
    });
  });

  test('does not invent a middle group when every count is the same', () => {
    const scale = countScale([4, 4, null]);
    expect(scale.classify(4)).toBe('near');
    expect(scale.classify(null)).toBe('none');
  });
});

describe('electrification', () => {
  test('keeps the published 2024 province ratios and separates 100% from the lowest provinces', () => {
    expect(Object.keys(ELECTRIFICATION)).toHaveLength(38);
    expect(electrificationClass(ELECTRIFICATION['31'] ?? null)).toBe('far-above');
    expect(electrificationClass(ELECTRIFICATION['32'] ?? null)).toBe('above');
    expect(electrificationClass(ELECTRIFICATION['81'] ?? null)).toBe('near');
    expect(electrificationClass(ELECTRIFICATION['62'] ?? null)).toBe('below');
    expect(electrificationClass(ELECTRIFICATION['95'] ?? null)).toBe('far-below');
    expect(ELECTRIFICATION['95']).toBe('94.02');
    expect(ELECTRIFICATION['53']).toBe('96.35');
    expect(formatRatio('99.83')).toBe('99,83%');
  });
});
describe('spreadReading', () => {
  test('reads Kota Bandung inside Jawa Barat and keeps electricity at the province ratio', () => {
    const hospitals = spreadReading('32.73', 'rumah-sakit');
    const scale = provinceQuantityScale('32', 'rumah-sakit');
    expect(hospitals.figure).toBe('42');
    expect(hospitals.mapClass).toBe(scale.classify(42));
    expect(hospitals.sentence).toContain('Jawa Barat');
    expect(hospitals.sentence).toContain('bukan per penduduk');

    const power = spreadReading('32.73', 'listrik');
    expect(power.figure).toBe('99,99%');
    expect(power.mapClass).toBe('above');
    expect(power.sentence).toContain('angka yang sama');
    expect(power.sentence).toContain('99,83%');
  });
});

describe('placeSnapshot', () => {
  test('reads Kota Bandung hospital and school counts from the published artifact', () => {
    const bandung = placeSnapshot('32.73');
    expect(bandung.hospitals).toEqual({ total: 42, umum: 27, ibuAnak: 5, khusus: 10 });
    expect(bandung.schools?.total).toBe(569 + 321 + 180 + 107);
    expect(placeSnapshot('99.99')).toEqual({ hospitals: null, schools: null });
  });
});
