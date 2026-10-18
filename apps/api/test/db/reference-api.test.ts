import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { treaty } from '@elysiajs/eden';
import { ErrorResponseSchema } from '@jaga-daerah/contracts';
import type { ErrorCode } from '@jaga-daerah/contracts';
import { eq, sql } from 'drizzle-orm';
import { Client } from 'pg';

import { createApp } from '#api/app';
import { createDatabase } from '#api/db/client';
import { provinces, regions } from '#api/db/schema/index';
import { regionSearchQuery, regionsInProvinceQuery } from '#api/repositories/reference-repository';

import { TEST_DATABASE_STARTUP_TIMEOUT_MS, startTestDatabase } from './support/test-database';
import type { TestDatabase } from './support/test-database';

const REFERENCE_CACHE = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400';
const SEARCH_CACHE = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';

interface SqlQuery {
  toSQL(): { sql: string; params: unknown[] };
}

// Small tables make the planner prefer sequential scans; disabling them proves the indexes can
// serve these exact queries once the table grows.
async function explainWithoutSeqScan(connectionString: string, query: SqlQuery): Promise<string> {
  const { sql: text, params } = query.toSQL();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('SET enable_seqscan = off');
    const result = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${text}`, params);
    return result.rows.map((row) => row['QUERY PLAN']).join('\n');
  } finally {
    await client.end();
  }
}

function createClient(runtimeUrl: string) {
  const app = createApp({
    openDatabase: () => createDatabase(runtimeUrl),
    allowedOrigins: ['http://localhost:4321'],
  });
  // Eden Treaty calls app.handle() in-process with types inferred from the route contracts.
  return { app, api: treaty(app) };
}

describe('reference API over the read-only runtime role', () => {
  let database: TestDatabase | undefined;
  let client: ReturnType<typeof createClient> | undefined;

  function current() {
    if (database === undefined || client === undefined) {
      throw new Error('Test database was not initialised.');
    }
    return { database, ...client };
  }

  async function searchCodes(q: string): Promise<string[]> {
    const { data, status } = await current().api.v1.daerah.search.get({ query: { q } });
    expect(status).toBe(200);
    return data?.data.items.map(({ code }) => code) ?? [];
  }

  /** For malformed input that the typed client deliberately cannot express. */
  async function expectRawError(path: string, status: number, code: ErrorCode) {
    const response = await current().app.handle(new Request(`http://localhost${path}`));
    const body = ErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Request-Id')).toBe(body.error.request_id);
    return body;
  }

  beforeAll(async () => {
    database = await startTestDatabase();
    client = createClient(database.runtimeUrl);
  }, TEST_DATABASE_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await database?.stop();
  });

  describe('GET /v1/provinsi', () => {
    test('lists provinces ordered by code with string codes and edge cache headers', async () => {
      const { data, status, response } = await current().api.v1.provinsi.get({ query: {} });

      expect(status).toBe(200);
      expect(data?.data.items.map(({ code }) => code)).toEqual(['11', '32']);
      expect(data?.meta.dataset_version).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe(REFERENCE_CACHE);
      expect(response.headers.get('X-Request-Id')).toBe(data?.meta.request_id ?? null);
    });

    test('rejects unknown query parameters', async () => {
      const body = await expectRawError('/v1/provinsi?year=2024', 400, 'INVALID_QUERY');

      expect(body.error.details?.[0]?.field).toBe('year');
    });
  });

  describe('GET /v1/provinsi/:kode/daerah', () => {
    test('lists active regions of a province ordered by code', async () => {
      const { data, status, response } = await current()
        .api.v1.provinsi({ kode: '32' })
        .daerah.get({ query: {} });

      expect(status).toBe(200);
      expect(data?.data.province).toEqual({ code: '32', name: 'Jawa Barat', slug: 'jawa-barat' });
      expect(data?.data.items.map(({ code }) => code)).toEqual(['32.04', '32.17', '32.73']);
      expect(data?.data.next_cursor).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe(REFERENCE_CACHE);
    });

    test('paginates with an opaque cursor until next_cursor is null', async () => {
      const regionsOf32 = current().api.v1.provinsi({ kode: '32' }).daerah;

      const first = await regionsOf32.get({ query: { limit: 2 } });
      expect(first.data?.data.items.map(({ code }) => code)).toEqual(['32.04', '32.17']);
      const cursor = first.data?.data.next_cursor;
      expect(cursor).toBeString();

      const second = await regionsOf32.get({ query: { limit: 2, cursor: cursor ?? undefined } });
      expect(second.data?.data.items.map(({ code }) => code)).toEqual(['32.73']);
      expect(second.data?.data.next_cursor).toBeNull();
    });

    test('returns PROVINSI_NOT_FOUND for a well-formed unknown code', async () => {
      const { error, status, response } = await current()
        .api.v1.provinsi({ kode: '99' })
        .daerah.get({ query: {} });

      expect(status).toBe(404);
      expect(error?.value).toMatchObject({ error: { code: 'PROVINSI_NOT_FOUND' } });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    test.each([
      ['malformed province code', '/v1/provinsi/3/daerah'],
      ['cursor that does not decode to a region code', '/v1/provinsi/32/daerah?cursor=Zm9v'],
      ['limit above the maximum', '/v1/provinsi/32/daerah?limit=51'],
    ])('rejects %s with INVALID_QUERY', async (_label, path) => {
      await expectRawError(path, 400, 'INVALID_QUERY');
    });
  });

  describe('GET /v1/daerah/search', () => {
    test('ranks exact matches before prefix matches', async () => {
      expect(await searchCodes('bandung')).toEqual(['32.04', '32.73', '32.17']);
      expect(await searchCodes('kota bandung')).toEqual(['32.73']);
    });

    test('matches the bare name prefix without Kabupaten/Kota', async () => {
      expect(await searchCodes('band')).toEqual(['11.71', '32.04', '32.73', '32.17']);
    });

    test('matches the full name prefix including the type', async () => {
      expect(await searchCodes('kota b')).toEqual(['11.71', '32.73']);
    });

    test('normalizes case and whitespace before searching', async () => {
      expect(await searchCodes('  KOTA   Bandung ')).toEqual(['32.73']);
    });

    test('returns province context and edge cache headers', async () => {
      const { data, response } = await current().api.v1.daerah.search.get({
        query: { q: 'kota bandung' },
      });

      expect(data?.data.items[0]?.province).toEqual({
        code: '32',
        name: 'Jawa Barat',
        slug: 'jawa-barat',
      });
      expect(response.headers.get('Cache-Control')).toBe(SEARCH_CACHE);
    });

    test('returns an empty list when nothing matches', async () => {
      expect(await searchCodes('zzz')).toEqual([]);
    });

    test('honours the limit', async () => {
      const { data } = await current().api.v1.daerah.search.get({ query: { q: 'band', limit: 1 } });

      expect(data?.data.items).toHaveLength(1);
    });

    test.each([
      ['empty q', ''],
      ['single character', 'b'],
      ['LIKE wildcard', 'ban%'],
    ])('rejects %s with INVALID_QUERY', async (_label, q) => {
      const { error, status, response } = await current().api.v1.daerah.search.get({
        query: { q },
      });

      expect(status).toBe(400);
      expect(error?.value).toMatchObject({ error: { code: 'INVALID_QUERY' } });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    test.each([
      ['missing q', '/v1/daerah/search'],
      ['limit above 10', '/v1/daerah/search?q=ban&limit=11'],
    ])('rejects %s with INVALID_QUERY', async (_label, path) => {
      await expectRawError(path, 400, 'INVALID_QUERY');
    });
  });

  describe('query plans', () => {
    test('region search uses the prefix indexes', async () => {
      const { owner, ownerUrl } = current().database;
      const text = await explainWithoutSeqScan(
        ownerUrl,
        regionSearchQuery(owner.db, { term: 'band', limit: 10 }),
      );

      expect(text).toContain('regions_search_name_idx');
      expect(text).toContain('regions_name_lower_idx');
    });

    test('province region listing uses the province index', async () => {
      const { owner, ownerUrl } = current().database;
      const [province] = await owner.db
        .select({ id: provinces.id })
        .from(provinces)
        .where(eq(provinces.code, '32'));
      if (province === undefined) {
        throw new Error('Seed province 32 is missing.');
      }

      const text = await explainWithoutSeqScan(
        ownerUrl,
        regionsInProvinceQuery(owner.db, {
          provinceId: province.id,
          afterCode: undefined,
          limit: 51,
        }),
      );

      expect(text).toMatch(/regions_province_id_idx|regions_code_unique/);
    });
  });

  // Runs last because it mutates shared seed rows.
  describe('deactivated regions', () => {
    test('are excluded from listings and search', async () => {
      const { owner } = current().database;
      await owner.db.update(regions).set({ isActive: false }).where(eq(regions.code, '11.71'));

      expect(await searchCodes('banda')).toEqual([]);
      const listing = await current().api.v1.provinsi({ kode: '11' }).daerah.get({ query: {} });
      expect(listing.data?.data.items).toEqual([]);

      const [{ count } = { count: '' }] = (
        await owner.db.execute<{ count: string }>(
          sql`SELECT count(*)::text AS count FROM regions WHERE NOT is_active`,
        )
      ).rows;
      expect(count).toBe('1');
    });
  });

  test('unknown routes return the NOT_FOUND envelope', async () => {
    await expectRawError('/v1/tidak-ada', 404, 'NOT_FOUND');
  });
});
