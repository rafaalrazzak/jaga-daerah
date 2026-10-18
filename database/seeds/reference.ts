// Deterministic development/test reference data. Codes follow the Kemendagri administrative
// code format and stay strings so leading zeroes and dots are preserved.

export const SEED_PROVINCES = [
  { code: '11', name: 'Aceh', slug: 'aceh' },
  { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
] as const;

export const SEED_REGIONS = [
  {
    provinceCode: '11',
    code: '11.71',
    name: 'Kota Banda Aceh',
    slug: 'kota-banda-aceh',
    type: 'kota',
  },
  {
    provinceCode: '32',
    code: '32.04',
    name: 'Kabupaten Bandung',
    slug: 'kabupaten-bandung',
    type: 'kabupaten',
  },
  {
    provinceCode: '32',
    code: '32.17',
    name: 'Kabupaten Bandung Barat',
    slug: 'kabupaten-bandung-barat',
    type: 'kabupaten',
  },
  {
    provinceCode: '32',
    code: '32.73',
    name: 'Kota Bandung',
    slug: 'kota-bandung',
    type: 'kota',
  },
] as const;
