import { describe, expect, test } from 'bun:test';

import type {
  DisasterRecord,
  ProfileRegionRecord,
  ProfileRepository,
} from '#api/repositories/profile-repository';

import { buildDisasterModule, getMapRealization, getRegionProfile } from './profile-service';

const PROVINCE = { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };
const REGION: ProfileRegionRecord = {
  id: 7,
  code: '32.73',
  name: 'Kota Bandung',
  slug: 'kota-bandung',
  type: 'kota',
  province: { id: 3, ...PROVINCE },
};
const ALL_TYPES = [
  'banjir',
  'cuaca_ekstrem',
  'erupsi_gunung_api',
  'gelombang_pasang_abrasi',
  'gempabumi',
  'kebakaran_hutan_lahan',
  'kekeringan',
  'tanah_longsor',
  'tsunami',
];

function disasters(): DisasterRecord[] {
  return ALL_TYPES.map((disasterType, index) => ({
    disasterType,
    eventCount: index,
    deaths: 0,
    missing: 0,
    affected: index * 10,
  }));
}

function repository(overrides: Partial<ProfileRepository> = {}): ProfileRepository {
  return {
    findActiveVersion: async () => ({
      id: 1,
      version: 'v1',
      publishedAt: new Date('2026-10-17T00:00:00Z'),
    }),
    findRegionBySlug: async (slug) => (slug === REGION.slug ? REGION : undefined),
    listAvailableYears: async () => [2025, 2024],
    findBudget: async () => ({ budgetAmount: '100.00', realizationAmount: '90.00' }),
    listExpenditures: async () => [
      { expenditureType: 'belanja_pegawai', budgetAmount: '60.00', realizationAmount: '50.00' },
      {
        expenditureType: 'belanja_barang_dan_jasa',
        budgetAmount: '40.00',
        realizationAmount: '40.00',
      },
    ],
    findNationalMedianPercent: async () => '95.0',
    listNaturalResources: async () => [],
    listDisasters: async () => disasters(),
    listDisasterNotes: async () => [],
    listSources: async () => [],
    listPublishedYears: async () => [2024, 2025],
    listRegionBudgets: async () => [
      { code: '32.73', budgetAmount: '100.00', realizationAmount: '90.00' },
      { code: '32.74', budgetAmount: '100.00', realizationAmount: '99.00' },
      { code: '32.75', budgetAmount: '0.00', realizationAmount: '0.00' },
      { code: '32.76', budgetAmount: null, realizationAmount: '10.00' },
    ],
    countCoverage: async () => ({ provinces: 38, regions: 514, regionsWithBudget: 508 }),
    ...overrides,
  };
}

describe('getRegionProfile', () => {
  test('defaults to the latest available year and computes metrics', async () => {
    const result = await getRegionProfile(repository(), { slug: 'kota-bandung', year: undefined });

    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.profile.year).toBe(2025);
    expect(result.profile.budget).toMatchObject({
      status: 'complete',
      realization_percent: '90.0',
      median_comparison: 'below',
    });
    expect(result.datasetVersion).toBe('v1');
  });

  test('reports an unavailable year with the years that exist', async () => {
    expect(await getRegionProfile(repository(), { slug: 'kota-bandung', year: 2019 })).toEqual({
      kind: 'year-unavailable',
      availableYears: [2025, 2024],
    });
  });

  test('reports unknown regions and missing publications', async () => {
    expect((await getRegionProfile(repository(), { slug: 'atlantis', year: undefined })).kind).toBe(
      'region-not-found',
    );
    expect(
      (
        await getRegionProfile(repository({ findActiveVersion: async () => undefined }), {
          slug: 'kota-bandung',
          year: undefined,
        })
      ).kind,
    ).toBe('no-published-dataset');
  });

  test('keeps the disaster module when the budget is missing (independent modules)', async () => {
    const result = await getRegionProfile(repository({ findBudget: async () => undefined }), {
      slug: 'kota-bandung',
      year: 2025,
    });

    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.profile.budget.status).toBe('unavailable');
    expect(result.profile.budget.realization_percent).toBeNull();
    expect(result.profile.disaster.status).toBe('complete');
  });

  test('marks a budget with one missing amount as partial, not zero', async () => {
    const result = await getRegionProfile(
      repository({ findBudget: async () => ({ budgetAmount: '100.00', realizationAmount: null }) }),
      { slug: 'kota-bandung', year: 2025 },
    );

    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.profile.budget).toMatchObject({
      status: 'partial',
      realization_amount: null,
      realization_percent: null,
    });
  });
});

describe('getMapRealization', () => {
  test('computes percent and median comparison per region, keeping missing data null', async () => {
    const result = await getMapRealization(repository(), { year: undefined });

    if (result.kind !== 'found') throw new Error(result.kind);
    expect(result.map.year).toBe(2025);
    expect(result.map.available_years).toEqual([2025, 2024]);
    expect(result.map.national_median_percent).toBe('95.0');
    expect(result.map.items).toEqual([
      { code: '32.73', realization_percent: '90.0', median_comparison: 'below' },
      { code: '32.74', realization_percent: '99.0', median_comparison: 'above' },
      { code: '32.75', realization_percent: null, median_comparison: null },
      { code: '32.76', realization_percent: null, median_comparison: null },
    ]);
  });

  test('rejects unpublished years and missing publications', async () => {
    expect(await getMapRealization(repository(), { year: 2019 })).toEqual({
      kind: 'year-unavailable',
      availableYears: [2025, 2024],
    });
    expect(
      (
        await getMapRealization(repository({ findActiveVersion: async () => undefined }), {
          year: undefined,
        })
      ).kind,
    ).toBe('no-published-dataset');
  });
});

describe('buildDisasterModule', () => {
  test('labels province level and sums reported values', () => {
    const module = buildDisasterModule(PROVINCE, disasters(), ['catatan']);

    expect(module.level).toBe('provinsi');
    expect(module.status).toBe('complete');
    expect(module.totals.event_count).toBe(36);
    expect(module.by_type).toHaveLength(9);
    expect(module.notes).toEqual(['catatan']);
  });

  test('is partial when some values are not reported, and keeps them null', () => {
    const records = disasters();
    records[8] = { ...records[8], disasterType: 'tsunami', eventCount: null } as DisasterRecord;

    const module = buildDisasterModule(PROVINCE, records, []);

    expect(module.status).toBe('partial');
    expect(module.by_type.find((row) => row.type === 'tsunami')?.event_count).toBeNull();
  });

  test('is unavailable without rows, with null totals rather than zero', () => {
    const module = buildDisasterModule(PROVINCE, [], []);

    expect(module.status).toBe('unavailable');
    expect(module.totals).toEqual({
      event_count: null,
      deaths: null,
      missing: null,
      affected: null,
    });
  });
});
