import { describe, expect, test } from 'bun:test';

import type {
  ReferenceRepository,
  RegionRecord,
  RegionsInProvinceParams,
} from '#api/repositories/reference-repository';

import {
  decodeRegionCursor,
  encodeRegionCursor,
  listProvinceRegions,
  searchRegions,
} from './reference-service';

const JAWA_BARAT = { id: 7, code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };
const REGIONS: RegionRecord[] = [
  { code: '32.04', name: 'Kabupaten Bandung', slug: 'kabupaten-bandung', type: 'kabupaten' },
  {
    code: '32.17',
    name: 'Kabupaten Bandung Barat',
    slug: 'kabupaten-bandung-barat',
    type: 'kabupaten',
  },
  { code: '32.73', name: 'Kota Bandung', slug: 'kota-bandung', type: 'kota' },
];

function fakeRepository(overrides: Partial<ReferenceRepository> = {}) {
  const regionCalls: RegionsInProvinceParams[] = [];
  const repository: ReferenceRepository = {
    listProvinces: async () => [JAWA_BARAT],
    findProvinceByCode: async (code) => (code === '32' ? JAWA_BARAT : undefined),
    listActiveRegionsInProvince: async (params) => {
      regionCalls.push(params);
      return REGIONS.filter(
        ({ code }) => params.afterCode === undefined || code > params.afterCode,
      ).slice(0, params.limit);
    },
    searchActiveRegions: async () => [],
    ...overrides,
  };
  return { repository, regionCalls };
}

describe('region cursor', () => {
  test('round-trips a region code through an opaque base64url string', () => {
    const cursor = encodeRegionCursor('32.73');

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRegionCursor(cursor)).toBe('32.73');
  });

  test.each(['Zm9v', '!!!', ''])('rejects cursor %p that is not a region code', (cursor) => {
    expect(decodeRegionCursor(cursor)).toBeUndefined();
  });
});

describe('listProvinceRegions', () => {
  test('returns a next cursor only when another page exists', async () => {
    const { repository, regionCalls } = fakeRepository();

    const first = await listProvinceRegions(repository, {
      provinceCode: '32',
      cursor: undefined,
      limit: 2,
    });
    if (first.kind !== 'found') throw new Error(`unexpected ${first.kind}`);
    expect(first.items.map(({ code }) => code)).toEqual(['32.04', '32.17']);
    expect(regionCalls[0]).toEqual({ provinceId: 7, afterCode: undefined, limit: 3 });

    const second = await listProvinceRegions(repository, {
      provinceCode: '32',
      cursor: first.nextCursor ?? undefined,
      limit: 2,
    });
    if (second.kind !== 'found') throw new Error(`unexpected ${second.kind}`);
    expect(second.items.map(({ code }) => code)).toEqual(['32.73']);
    expect(second.nextCursor).toBeNull();
  });

  test('reports an unknown province', async () => {
    const { repository } = fakeRepository();

    expect(
      await listProvinceRegions(repository, { provinceCode: '99', cursor: undefined, limit: 2 }),
    ).toEqual({ kind: 'province-not-found' });
  });

  test('rejects an invalid cursor before querying the database', async () => {
    const { repository, regionCalls } = fakeRepository();

    expect(
      await listProvinceRegions(repository, { provinceCode: '32', cursor: 'Zm9v', limit: 2 }),
    ).toEqual({ kind: 'invalid-cursor' });
    expect(regionCalls).toEqual([]);
  });
});

describe('searchRegions', () => {
  test('lowercases the normalized query before it reaches the repository', async () => {
    const terms: string[] = [];
    const { repository } = fakeRepository({
      searchActiveRegions: async ({ term }) => {
        terms.push(term);
        return [];
      },
    });

    await searchRegions(repository, { query: 'Kota Bandung', limit: 10 });

    expect(terms).toEqual(['kota bandung']);
  });
});
