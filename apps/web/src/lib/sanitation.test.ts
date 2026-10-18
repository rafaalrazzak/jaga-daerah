import { describe, expect, test } from 'bun:test';

import { SANITATION } from './sanitation';

describe('sanitation', () => {
  test('reads the 2025 BPS table by Kemendagri code and leaves a blank cell empty', () => {
    expect(SANITATION.year).toBe(2025);
    expect(SANITATION.regions['32.73']).toEqual({ percent: '56.50' });
    expect(SANITATION.regions['11.09']?.percent).toBe('78.94');
    expect(SANITATION.regions['76.01']?.percent).toBe('84.15');
    expect(SANITATION.regions['93.01']?.percent).toBe('88.37');
    expect(SANITATION.regions['95.01']?.percent).toBe('43.70');
    expect(SANITATION.regions['51.03']?.percent).toBe('100.00');
    expect(SANITATION.regions['94.05']).toBeUndefined();
    expect(Object.keys(SANITATION.regions)).toHaveLength(513);
    expect(SANITATION.note).toContain('Susenas KOR');
    expect(SANITATION.note).toContain('bukan sanitasi aman');
  });
});
