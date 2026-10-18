import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { asc, eq, sql } from 'drizzle-orm';

import type { Database } from '#api/db/client';

import {
  budgetFacts,
  dataSources,
  datasetVersions,
  disasterFacts,
  expenditureBreakdownFacts,
  provinces,
  regions,
} from '#api/db/schema/index';

import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_INSUFFICIENT_PRIVILEGE,
  PG_INVALID_TEXT_REPRESENTATION,
  PG_RESTRICT_VIOLATION,
  PG_UNIQUE_VIOLATION,
  expectPostgresError,
} from './support/postgres-errors';
import {
  MIGRATIONS_FOLDER,
  TEST_DATABASE_STARTUP_TIMEOUT_MS,
  startTestDatabase,
} from './support/test-database';
import type { TestDatabase } from './support/test-database';

async function createFactFixture(db: Database, version = 'facts-test') {
  const [versionRow] = await db
    .insert(datasetVersions)
    .values({ version, status: 'staging' })
    .returning({ id: datasetVersions.id });
  const [source] = await db
    .insert(dataSources)
    .values({
      datasetVersionId: versionRow?.id ?? 0,
      publisher: 'DJPK Kemenkeu',
      title: 'fixture',
      sourceUrl: 'https://djpk.kemenkeu.go.id/portal/data/apbd',
      period: '2025',
      downloadedAt: new Date('2026-10-17T00:00:00Z'),
      checksumSha256: 'a'.repeat(64),
    })
    .returning({ id: dataSources.id });
  const [region] = await db
    .select({ id: regions.id })
    .from(regions)
    .where(eq(regions.code, '32.73'));
  const [province] = await db
    .select({ id: provinces.id })
    .from(provinces)
    .where(eq(provinces.code, '32'));
  if (!versionRow || !source || !region || !province) {
    throw new Error('fact fixture setup failed');
  }
  return {
    versionId: versionRow.id,
    sourceId: source.id,
    regionId: region.id,
    provinceId: province.id,
  };
}

describe('PostgreSQL schema and generated migrations', () => {
  let database: TestDatabase | undefined;

  function current(): TestDatabase {
    if (database === undefined) {
      throw new Error('Test database was not initialised.');
    }
    return database;
  }

  const ownerDb = () => current().owner.db;
  const runtimeDb = () => current().runtime.db;
  const etlDb = () => current().etl.db;

  beforeAll(async () => {
    database = await startTestDatabase();
  }, TEST_DATABASE_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await database?.stop();
  });

  test('applies every committed migration to an empty database exactly once', async () => {
    const journal = JSON.parse(
      await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    const applied = await ownerDb().execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`,
    );

    expect(applied.rows[0]?.count).toBe(String(journal.entries.length));
  });

  test('stores deterministic seed codes as strings with leading zeroes and dots intact', async () => {
    const rows = await ownerDb()
      .select({ code: regions.code, provinceCode: provinces.code, type: regions.type })
      .from(regions)
      .innerJoin(provinces, eq(regions.provinceId, provinces.id))
      .orderBy(asc(regions.code));

    expect(rows).toEqual([
      { code: '11.71', provinceCode: '11', type: 'kota' },
      { code: '32.04', provinceCode: '32', type: 'kabupaten' },
      { code: '32.17', provinceCode: '32', type: 'kabupaten' },
      { code: '32.73', provinceCode: '32', type: 'kota' },
    ]);
  });

  test('rejects a duplicate province code', async () => {
    await expectPostgresError(
      ownerDb().insert(provinces).values({ code: '32', name: 'Duplikat', slug: 'duplikat' }),
      PG_UNIQUE_VIOLATION,
    );
  });

  test('rejects a duplicate region slug', async () => {
    const [province] = await ownerDb()
      .select({ id: provinces.id })
      .from(provinces)
      .where(eq(provinces.code, '32'));
    if (province === undefined) {
      throw new Error('Seed province 32 is missing.');
    }

    await expectPostgresError(
      ownerDb().insert(regions).values({
        provinceId: province.id,
        code: '32.99',
        name: 'Kota Bandung Lain',
        slug: 'kota-bandung',
        type: 'kota',
      }),
      PG_UNIQUE_VIOLATION,
    );
  });

  test('rejects a region that references a missing province', async () => {
    await expectPostgresError(
      ownerDb().insert(regions).values({
        provinceId: 999_999,
        code: '99.01',
        name: 'Tidak Ada',
        slug: 'tidak-ada',
        type: 'kabupaten',
      }),
      PG_FOREIGN_KEY_VIOLATION,
    );
  });

  test('refuses to delete a province that still has regions', async () => {
    // PostgreSQL 16 reports ON DELETE RESTRICT as 23503. PostgreSQL 18 reports it as 23001.
    await expectPostgresError(ownerDb().delete(provinces).where(eq(provinces.code, '11')), [
      PG_FOREIGN_KEY_VIOLATION,
      PG_RESTRICT_VIOLATION,
    ]);
  });

  test('rejects an administrative code without the Kemendagri format', async () => {
    await expectPostgresError(
      ownerDb().insert(provinces).values({ code: '9', name: 'Format Salah', slug: 'format-salah' }),
      PG_CHECK_VIOLATION,
    );
  });

  test('allows at most one active dataset version', async () => {
    const publishedAt = new Date('2026-10-17T00:00:00Z');
    await ownerDb()
      .insert(datasetVersions)
      .values({ version: '2024.1', status: 'active', publishedAt });

    await expectPostgresError(
      ownerDb()
        .insert(datasetVersions)
        .values({ version: '2024.2', status: 'active', publishedAt }),
      PG_UNIQUE_VIOLATION,
    );
  });

  test('rejects an active dataset version without a publication time', async () => {
    await expectPostgresError(
      ownerDb().insert(datasetVersions).values({ version: '2025.1', status: 'active' }),
      PG_CHECK_VIOLATION,
    );
  });

  test('lets the runtime role read reference data', async () => {
    const rows = await runtimeDb().select({ code: provinces.code }).from(provinces);

    expect(rows.map(({ code }) => code).toSorted()).toEqual(['11', '32']);
  });

  test('prevents the runtime role from writing', async () => {
    await expectPostgresError(
      runtimeDb().insert(provinces).values({ code: '51', name: 'Bali', slug: 'bali' }),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    await expectPostgresError(
      runtimeDb().update(regions).set({ isActive: false }),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    await expectPostgresError(runtimeDb().delete(datasetVersions), PG_INSUFFICIENT_PRIVILEGE);
  });

  test('prevents the runtime role from changing the schema', async () => {
    await expectPostgresError(
      runtimeDb().execute(sql`CREATE TABLE runtime_should_not_create (id integer)`),
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  test('lets the ETL role insert and update reference data', async () => {
    await etlDb().insert(provinces).values({ code: '51', name: 'Bali', slug: 'bali' });
    await etlDb().update(provinces).set({ name: 'Provinsi Bali' }).where(eq(provinces.code, '51'));

    const [row] = await etlDb()
      .select({ name: provinces.name })
      .from(provinces)
      .where(eq(provinces.code, '51'));
    expect(row?.name).toBe('Provinsi Bali');
  });

  test('prevents the ETL role from deleting regions, dataset versions, or facts', async () => {
    await expectPostgresError(
      etlDb().delete(regions).where(eq(regions.code, '32.73')),
      PG_INSUFFICIENT_PRIVILEGE,
    );
    await expectPostgresError(etlDb().delete(datasetVersions), PG_INSUFFICIENT_PRIVILEGE);
    await expectPostgresError(etlDb().delete(budgetFacts), PG_INSUFFICIENT_PRIVILEGE);
  });

  test('derives search_name without the Kabupaten/Kota prefix', async () => {
    const rows = await ownerDb()
      .select({ code: regions.code, searchName: regions.searchName })
      .from(regions)
      .orderBy(asc(regions.code));

    expect(rows.map(({ searchName }) => searchName)).toEqual([
      'banda aceh',
      'bandung',
      'bandung barat',
      'bandung',
    ]);
  });

  describe('budget and disaster facts', () => {
    let context: Awaited<ReturnType<typeof createFactFixture>> | undefined;

    function facts() {
      if (context === undefined) throw new Error('fact context missing');
      return context;
    }

    beforeAll(async () => {
      context = await createFactFixture(ownerDb());
    });

    test('stores rupiah with exact cents and keeps NULL distinct from zero', async () => {
      const fixture = facts();
      await ownerDb().insert(budgetFacts).values({
        datasetVersionId: fixture.versionId,
        regionId: fixture.regionId,
        year: 2025,
        budgetAmount: '99999999999999999.99',
        realizationAmount: null,
        sourceId: fixture.sourceId,
      });

      const [row] = await ownerDb()
        .select({ budget: budgetFacts.budgetAmount, realization: budgetFacts.realizationAmount })
        .from(budgetFacts)
        .where(eq(budgetFacts.datasetVersionId, fixture.versionId));

      expect(row).toEqual({ budget: '99999999999999999.99', realization: null });

      await expectPostgresError(
        ownerDb().insert(budgetFacts).values({
          datasetVersionId: fixture.versionId,
          regionId: fixture.regionId,
          year: 2025,
          budgetAmount: '1',
          sourceId: fixture.sourceId,
        }),
        PG_UNIQUE_VIOLATION,
      );
    });

    test('rejects negative amounts and counts', async () => {
      const fixture = facts();

      await expectPostgresError(
        ownerDb().insert(budgetFacts).values({
          datasetVersionId: fixture.versionId,
          regionId: fixture.regionId,
          year: 2024,
          budgetAmount: '-1',
          sourceId: fixture.sourceId,
        }),
        PG_CHECK_VIOLATION,
      );
      await expectPostgresError(
        ownerDb().insert(disasterFacts).values({
          datasetVersionId: fixture.versionId,
          provinceId: fixture.provinceId,
          year: 2025,
          disasterType: 'banjir',
          deaths: -3,
          sourceId: fixture.sourceId,
        }),
        PG_CHECK_VIOLATION,
      );
    });

    test('lets the runtime role read facts but never write them', async () => {
      await runtimeDb().select({ id: budgetFacts.id }).from(budgetFacts).limit(1);
      await expectPostgresError(runtimeDb().delete(disasterFacts), PG_INSUFFICIENT_PRIVILEGE);
    });
  });

  describe('expenditure breakdown facts', () => {
    let versionId = 0;
    let sourceId = 0;
    let regionId = 0;

    beforeAll(async () => {
      const fixture = await createFactFixture(ownerDb(), 'expenditure-test');
      versionId = fixture.versionId;
      sourceId = fixture.sourceId;
      regionId = fixture.regionId;
    });

    const row = (overrides: Partial<typeof expenditureBreakdownFacts.$inferInsert> = {}) => ({
      datasetVersionId: versionId,
      regionId,
      year: 2025,
      expenditureType: 'belanja_pegawai' as const,
      budgetAmount: '100.00',
      realizationAmount: '90.00',
      sourceId,
      ...overrides,
    });

    test('keeps NULL distinct from an explicit zero and preserves exact cents', async () => {
      await ownerDb()
        .insert(expenditureBreakdownFacts)
        .values(row({ budgetAmount: '99999999999999999.99', realizationAmount: null }));

      const [stored] = await ownerDb()
        .select({
          budget: expenditureBreakdownFacts.budgetAmount,
          realization: expenditureBreakdownFacts.realizationAmount,
        })
        .from(expenditureBreakdownFacts)
        .where(eq(expenditureBreakdownFacts.datasetVersionId, versionId));

      expect(stored).toEqual({ budget: '99999999999999999.99', realization: null });
    });

    test('rejects negative amounts', async () => {
      await expectPostgresError(
        ownerDb()
          .insert(expenditureBreakdownFacts)
          .values(row({ expenditureType: 'belanja_modal', realizationAmount: '-1' })),
        PG_CHECK_VIOLATION,
      );
    });

    test('rejects an out-of-range year', async () => {
      await expectPostgresError(
        ownerDb()
          .insert(expenditureBreakdownFacts)
          .values(row({ expenditureType: 'belanja_bunga', year: 1999 })),
        PG_CHECK_VIOLATION,
      );
    });

    test('rejects a duplicate jenis for the same region, year, and version', async () => {
      await ownerDb()
        .insert(expenditureBreakdownFacts)
        .values(row({ expenditureType: 'belanja_hibah' }));

      await expectPostgresError(
        ownerDb()
          .insert(expenditureBreakdownFacts)
          .values(row({ expenditureType: 'belanja_hibah' })),
        PG_UNIQUE_VIOLATION,
      );
    });

    test('rejects an unknown jenis value', async () => {
      await expectPostgresError(
        ownerDb()
          .insert(expenditureBreakdownFacts)
          // The enum is what keeps "Belanja Lainnya" (an aggregate) out of the table.
          .values(row({ expenditureType: 'belanja_lainnya' as 'belanja_pegawai' })),
        PG_INVALID_TEXT_REPRESENTATION,
      );
    });

    test('lets the runtime role read the breakdown but never write it', async () => {
      await runtimeDb()
        .select({ id: expenditureBreakdownFacts.id })
        .from(expenditureBreakdownFacts)
        .limit(1);
      await expectPostgresError(
        runtimeDb().delete(expenditureBreakdownFacts),
        PG_INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});
