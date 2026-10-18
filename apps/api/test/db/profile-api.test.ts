import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { treaty } from '@elysiajs/eden';
import {
  ErrorResponseSchema,
  MapRealizationResponseSchema,
  RegionProfileResponseSchema,
} from '@jaga-daerah/contracts';

import { createApp } from '#api/app';
import { createDatabase } from '#api/db/client';

import { FACTS_VERSION, seedPublishedFacts } from './support/seed-facts';
import { TEST_DATABASE_STARTUP_TIMEOUT_MS, startTestDatabase } from './support/test-database';
import type { TestDatabase } from './support/test-database';

const PROFILE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

function createClient(runtimeUrl: string) {
  const app = createApp({
    openDatabase: () => createDatabase(runtimeUrl),
    allowedOrigins: ['http://localhost:4321'],
    fetchUpstream: () => Promise.reject(new Error('no upstream in tests')),
    firmsMapKey: undefined,
  });
  // parseDate: false keeps ISO strings, matching what browsers receive and the contracts expect.
  return { app, api: treaty(app, { parseDate: false }) };
}

describe('region profile API over the read-only runtime role', () => {
  let database: TestDatabase | undefined;
  let client: ReturnType<typeof createClient> | undefined;

  function api() {
    if (client === undefined) throw new Error('client not initialised');
    return client.api;
  }

  async function profile(slug: string, year?: number) {
    return api()
      .v1.daerah({ slug })
      .get({ query: year === undefined ? {} : { year } });
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    await seedPublishedFacts(database.owner.db);
    client = createClient(database.runtimeUrl);
  }, TEST_DATABASE_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await database?.stop();
  });

  test('returns a complete profile for the latest year with exact rupiah strings', async () => {
    const { data, status, response } = await profile('kota-bandung');

    expect(status).toBe(200);
    const parsed = RegionProfileResponseSchema.parse(data);
    expect(parsed.meta.dataset_version).toBe(FACTS_VERSION);
    expect(parsed.data.year).toBe(2025);
    expect(parsed.data.budget).toMatchObject({
      status: 'complete',
      budget_amount: '8345231335444.90',
      realization_amount: '7490617461211.10',
      realization_percent: '89.8',
      // Median of 89.758…% and 95.0% (Kab. Bandung has no realisation, so it is excluded).
      national_median_percent: '92.4',
      median_comparison: 'below',
    });
    expect(parsed.data.budget.narrative[0]).toContain('Rp89,8 ribu');
    expect(parsed.data.natural_resources).toMatchObject({
      status: 'partial',
      total_budget_amount: '1215850000000.00',
      total_realization_amount: null,
    });
    expect(parsed.data.natural_resources.by_type.map(({ type }) => type)).toEqual([
      'panas_bumi',
      'minyak_bumi',
      'gas_bumi',
    ]);
    expect(parsed.data.disaster).toMatchObject({ level: 'provinsi', status: 'complete' });
    expect(parsed.data.disaster.province.code).toBe('32');
    expect(parsed.data.disaster.notes).toHaveLength(1);
    expect(parsed.data.sources.map(({ publisher }) => publisher)).toEqual([
      'BNPB',
      'DJPK Kemenkeu',
    ]);
    expect(response.headers.get('Cache-Control')).toBe(PROFILE_CACHE);
  });

  test('returns the expenditure breakdown by jenis with exact rupiah strings', async () => {
    const { data, status } = await profile('kota-bandung');

    expect(status).toBe(200);
    const parsed = RegionProfileResponseSchema.parse(data);
    const breakdown = parsed.data.expenditure_breakdown;
    expect(breakdown.status).toBe('complete');
    // The jenis rows carry the published Belanja Daerah total, with the source's Rp0.03 rounding.
    expect(breakdown.total_budget_amount).toBe('8345231335444.93');
    expect(breakdown.total_realization_amount).toBe('7490617461211.10');
    expect(breakdown.narrative[0]).toContain('jenis belanja');
    expect(breakdown.narrative[1]).toContain('bukan belanja per program');
    // Largest realisation first, so belanja barang dan jasa leads the list.
    expect(breakdown.by_type[0]).toMatchObject({
      type: 'belanja_barang_dan_jasa',
      label: 'Belanja barang dan jasa',
      budget_amount: '3961088112461.60',
      realization_amount: '3451980612625.10',
    });
    for (const row of breakdown.by_type) {
      expect(row.budget_share_percent).not.toBeNull();
    }
  });

  test('renders a partial jenis breakdown without inventing a total', async () => {
    const { data } = await profile('kabupaten-bandung', 2025);

    const breakdown = RegionProfileResponseSchema.parse(data).data.expenditure_breakdown;
    expect(breakdown.status).toBe('partial');
    expect(breakdown.total_budget_amount).toBe('1000.00');
    // One blank realisation, so no partial sum is published as a total.
    expect(breakdown.total_realization_amount).toBeNull();
  });

  test('renders an unavailable breakdown for a region with no jenis rows', async () => {
    const { data } = await profile('kabupaten-bandung-barat', 2025);

    const parsed = RegionProfileResponseSchema.parse(data);
    const breakdown = parsed.data.expenditure_breakdown;
    expect(breakdown).toMatchObject({ status: 'unavailable', by_type: [] });
    expect(breakdown.narrative[0]).toContain('tidak memuat rincian belanja');
    expect(parsed.data.expenditure_by_function).toMatchObject({
      status: 'unavailable',
      by_function: [],
      total_realization_amount: null,
    });
  });

  test('renders a partial budget without inventing a percentage', async () => {
    const { data } = await profile('kabupaten-bandung', 2025);

    expect(data?.data.natural_resources).toMatchObject({ status: 'unavailable', by_type: [] });
    expect(data?.data.budget).toMatchObject({
      status: 'partial',
      budget_amount: '1000.00',
      realization_amount: null,
      realization_percent: null,
    });
    expect(data?.data.disaster.status).toBe('complete');
  });

  test('keeps the disaster module when the selected year has no budget row', async () => {
    const { data } = await profile('kota-banda-aceh', 2025);

    expect(data?.data.available_years).toEqual([2025, 2024]);
    expect(data?.data.budget.status).toBe('unavailable');
    expect(data?.data.disaster.status).toBe('partial');
    expect(
      data?.data.disaster.by_type.find(({ type }) => type === 'tsunami')?.event_count,
    ).toBeNull();
  });

  test('returns YEAR_NOT_AVAILABLE with the available years listed', async () => {
    const { error, status } = await profile('kota-bandung', 2019);
    const body = ErrorResponseSchema.parse(error?.value);

    expect(status).toBe(404);
    expect(body.error.code).toBe('YEAR_NOT_AVAILABLE');
    expect(body.error.details?.[0]?.message).toContain('2025');
  });

  test('returns DAERAH_NOT_FOUND for unknown slugs and INVALID_QUERY for malformed ones', async () => {
    const missing = await profile('kota-atlantis');
    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(missing.error?.value).error.code).toBe('DAERAH_NOT_FOUND');

    const malformed = await profile('Kota Bandung!');
    expect(malformed.status).toBe(400);
    expect(ErrorResponseSchema.parse(malformed.error?.value).error.code).toBe('INVALID_QUERY');
  });

  test('does not shadow the search route', async () => {
    const { status } = await api().v1.daerah.search.get({ query: { q: 'bandung' } });

    expect(status).toBe(200);
  });

  test('reports dataset status and coverage', async () => {
    const { data, status } = await api().v1.meta.status.get();

    expect(status).toBe(200);
    expect(data?.data).toMatchObject({
      dataset_version: FACTS_VERSION,
      years: [2024, 2025],
      coverage: { provinces: 2, regions: 4, regions_with_budget: 4 },
    });
  });

  test('returns realisation per region for the national map', async () => {
    const { data, status, response } = await api().v1.peta.realisasi.get({ query: {} });

    expect(status).toBe(200);
    const parsed = MapRealizationResponseSchema.parse(data);
    expect(parsed.data).toEqual({
      year: 2025,
      available_years: [2025, 2024],
      national_median_percent: '92.4',
      items: [
        { code: '32.04', realization_percent: null, median_comparison: null },
        { code: '32.17', realization_percent: '95.0', median_comparison: 'above' },
        { code: '32.73', realization_percent: '89.8', median_comparison: 'below' },
      ],
    });
    expect(response.headers.get('Cache-Control')).toBe(PROFILE_CACHE);

    const older = await api().v1.peta.realisasi.get({ query: { year: 2024 } });
    expect(older.data?.data.items).toEqual([
      { code: '11.71', realization_percent: '101.9', median_comparison: 'equal' },
    ]);

    const missing = await api().v1.peta.realisasi.get({ query: { year: 2019 } });
    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(missing.error?.value).error.code).toBe('YEAR_NOT_AVAILABLE');
  });
});
