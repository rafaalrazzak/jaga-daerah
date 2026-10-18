import { describe, expect, test } from 'bun:test';

import { WELFARE } from './welfare';

describe('welfare', () => {
  test('reads Kota Bandung from the 2025 BPS books and leaves an unreadable output cell empty', () => {
    expect(WELFARE.regions['32.73']).toEqual({
      poverty: { people_thousands: '99.12', percent: '3.78', line_rupiah: 644417 },
      output_per_person_thousands: 158495,
      development: { index: '84.66', adjusted_spending_thousands: 19280 },
    });
    expect(WELFARE.poverty.note).toContain('Susenas Maret 2025');
    expect(WELFARE.output.note).toContain('bukan gaji');
    expect(WELFARE.regions['93.01']?.output_per_person_thousands).toBeNull();
    expect(WELFARE.regions['93.01']?.poverty).not.toBeNull();
    expect(Object.keys(WELFARE.regions)).toHaveLength(514);
  });
});
