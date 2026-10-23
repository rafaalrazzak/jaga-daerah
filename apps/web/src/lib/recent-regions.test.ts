import { describe, expect, test } from 'bun:test';

import {
  addRecentRegion,
  parseRecentRegions,
  readRecentRegions,
  RECENT_REGIONS_KEY,
  RECENT_REGIONS_LIMIT,
  writeRecentRegions,
} from './recent-regions';
import type { RecentRegion } from './recent-regions';

const BANDUNG: RecentRegion = {
  code: '32.73',
  name: 'Kota Bandung',
  slug: 'kota-bandung',
  provinceName: 'Jawa Barat',
};
const SURABAYA: RecentRegion = {
  code: '35.78',
  name: 'Kota Surabaya',
  slug: 'kota-surabaya',
  provinceName: 'Jawa Timur',
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    read: (key: string) => data.get(key) ?? null,
  };
}

describe('parseRecentRegions', () => {
  test('returns an empty list for broken or foreign data', () => {
    expect(parseRecentRegions(null)).toEqual([]);
    expect(parseRecentRegions('not json')).toEqual([]);
    expect(parseRecentRegions('{"code":"32.73"}')).toEqual([]);
    expect(parseRecentRegions('[{"code":"32.73","name":"Kota Bandung"}]')).toEqual([]);
  });

  test('keeps valid entries and caps the list', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...BANDUNG,
      code: `32.${70 + index}`,
    }));
    expect(parseRecentRegions(JSON.stringify(many))).toHaveLength(RECENT_REGIONS_LIMIT);
  });
});

describe('addRecentRegion', () => {
  test('puts the newest region first and moves an existing one to the front', () => {
    expect(addRecentRegion([BANDUNG], SURABAYA).map((item) => item.code)).toEqual([
      '35.78',
      '32.73',
    ]);
    expect(addRecentRegion([BANDUNG, SURABAYA], BANDUNG).map((item) => item.code)).toEqual([
      '32.73',
      '35.78',
    ]);
  });

  test('drops the oldest entry beyond the limit', () => {
    const list = Array.from({ length: RECENT_REGIONS_LIMIT }, (_, index) => ({
      ...BANDUNG,
      code: `32.${70 + index}`,
    }));
    const next = addRecentRegion(list, SURABAYA);
    expect(next).toHaveLength(RECENT_REGIONS_LIMIT);
    expect(next[0]?.code).toBe('35.78');
    expect(next.at(-1)?.code).toBe(list[list.length - 2]?.code);
  });
});

describe('storage helpers', () => {
  test('round-trips recent regions', () => {
    const storage = memoryStorage();
    writeRecentRegions(storage, [BANDUNG]);
    expect(storage.read(RECENT_REGIONS_KEY)).toBe(JSON.stringify([BANDUNG]));
    expect(readRecentRegions(storage)).toEqual([BANDUNG]);
  });

  test('removes the key when the list is emptied', () => {
    const storage = memoryStorage({ [RECENT_REGIONS_KEY]: JSON.stringify([BANDUNG]) });
    writeRecentRegions(storage, []);
    expect(storage.read(RECENT_REGIONS_KEY)).toBeNull();
  });

  test('treats unavailable storage as an empty list', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readRecentRegions(broken)).toEqual([]);
    expect(() => writeRecentRegions(broken, [BANDUNG])).not.toThrow();
  });
});
