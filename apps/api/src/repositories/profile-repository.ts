import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';

import type { Database } from '#api/db/client';
import {
  budgetFacts,
  dataNotes,
  dataSources,
  datasetVersions,
  disasterFacts,
  expenditureBreakdownFacts,
  naturalResourceRevenueFacts,
  provinces,
  regions,
} from '#api/db/schema/index';

export interface ActiveVersionRecord {
  id: number;
  version: string;
  publishedAt: Date;
}

export interface ProfileRegionRecord {
  id: number;
  code: string;
  name: string;
  slug: string;
  type: 'kabupaten' | 'kota';
  province: { id: number; code: string; name: string; slug: string };
}

export interface BudgetRecord {
  budgetAmount: string | null;
  realizationAmount: string | null;
}

export interface NaturalResourceRecord {
  resourceType: string;
  budgetAmount: string | null;
  realizationAmount: string | null;
}

export interface ExpenditureRecord {
  expenditureType: string;
  budgetAmount: string | null;
  realizationAmount: string | null;
}

export interface DisasterRecord {
  disasterType: string;
  eventCount: number | null;
  deaths: number | null;
  missing: number | null;
  affected: number | null;
}

export interface SourceRecord {
  publisher: string;
  title: string;
  sourceUrl: string;
  period: string;
  downloadedAt: Date;
}

export interface RegionBudgetRecord extends BudgetRecord {
  code: string;
}

export interface CoverageRecord {
  provinces: number;
  regions: number;
  regionsWithBudget: number;
}

export interface ProfileRepository {
  findActiveVersion(): Promise<ActiveVersionRecord | undefined>;
  findRegionBySlug(slug: string): Promise<ProfileRegionRecord | undefined>;
  listAvailableYears(versionId: number, region: ProfileRegionRecord): Promise<number[]>;
  findBudget(versionId: number, regionId: number, year: number): Promise<BudgetRecord | undefined>;
  listExpenditures(versionId: number, regionId: number, year: number): Promise<ExpenditureRecord[]>;
  /** Median realisation percent (one decimal, as text) across kab/kota with both amounts. */
  findNationalMedianPercent(versionId: number, year: number): Promise<string | null>;
  listNaturalResources(
    versionId: number,
    regionId: number,
    year: number,
  ): Promise<NaturalResourceRecord[]>;
  listDisasters(versionId: number, provinceId: number, year: number): Promise<DisasterRecord[]>;
  listDisasterNotes(versionId: number, year: number): Promise<string[]>;
  listSources(versionId: number): Promise<SourceRecord[]>;
  listPublishedYears(versionId: number): Promise<number[]>;
  listRegionBudgets(versionId: number, year: number): Promise<RegionBudgetRecord[]>;
  countCoverage(versionId: number): Promise<CoverageRecord>;
}

export function createProfileRepository(db: Database): ProfileRepository {
  return {
    findActiveVersion: async () => {
      const [row] = await db
        .select({
          id: datasetVersions.id,
          version: datasetVersions.version,
          publishedAt: datasetVersions.publishedAt,
        })
        .from(datasetVersions)
        .where(eq(datasetVersions.status, 'active'))
        .limit(1);
      // The schema guarantees published_at for active versions (check constraint).
      return row?.publishedAt == null ? undefined : { ...row, publishedAt: row.publishedAt };
    },

    findRegionBySlug: async (slug) => {
      const [row] = await db
        .select({
          id: regions.id,
          code: regions.code,
          name: regions.name,
          slug: regions.slug,
          type: regions.type,
          provinceId: provinces.id,
          provinceCode: provinces.code,
          provinceName: provinces.name,
          provinceSlug: provinces.slug,
        })
        .from(regions)
        .innerJoin(provinces, eq(regions.provinceId, provinces.id))
        .where(and(eq(regions.slug, slug), eq(regions.isActive, true)))
        .limit(1);
      return row === undefined
        ? undefined
        : {
            id: row.id,
            code: row.code,
            name: row.name,
            slug: row.slug,
            type: row.type,
            province: {
              id: row.provinceId,
              code: row.provinceCode,
              name: row.provinceName,
              slug: row.provinceSlug,
            },
          };
    },

    listAvailableYears: async (versionId, region) => {
      const rows = await db.execute<{ year: number }>(sql`
        SELECT year FROM ${budgetFacts}
          WHERE ${budgetFacts.datasetVersionId} = ${versionId} AND ${budgetFacts.regionId} = ${region.id}
        UNION
        SELECT year FROM ${disasterFacts}
          WHERE ${disasterFacts.datasetVersionId} = ${versionId}
            AND ${disasterFacts.provinceId} = ${region.province.id}
        ORDER BY year DESC
      `);
      return rows.rows.map(({ year }) => Number(year));
    },

    findBudget: async (versionId, regionId, year) => {
      const [row] = await db
        .select({
          budgetAmount: budgetFacts.budgetAmount,
          realizationAmount: budgetFacts.realizationAmount,
        })
        .from(budgetFacts)
        .where(
          and(
            eq(budgetFacts.datasetVersionId, versionId),
            eq(budgetFacts.regionId, regionId),
            eq(budgetFacts.year, year),
          ),
        )
        .limit(1);
      return row;
    },

    findNationalMedianPercent: async (versionId, year) => {
      // percentile_cont works on double precision; the ratio is a percentage (0–1000), not money,
      // and is rounded to one decimal, so float error cannot affect the published value.
      const result = await db.execute<{ median: string | null }>(sql`
        SELECT round(
          (percentile_cont(0.5) WITHIN GROUP (
            ORDER BY (${budgetFacts.realizationAmount} * 100 / ${budgetFacts.budgetAmount})::double precision
          ))::numeric, 1)::text AS median
        FROM ${budgetFacts}
        WHERE ${budgetFacts.datasetVersionId} = ${versionId}
          AND ${budgetFacts.year} = ${year}
          AND ${budgetFacts.budgetAmount} > 0
          AND ${budgetFacts.realizationAmount} IS NOT NULL
      `);
      return result.rows[0]?.median ?? null;
    },

    listExpenditures: (versionId, regionId, year) =>
      db
        .select({
          expenditureType: expenditureBreakdownFacts.expenditureType,
          budgetAmount: expenditureBreakdownFacts.budgetAmount,
          realizationAmount: expenditureBreakdownFacts.realizationAmount,
        })
        .from(expenditureBreakdownFacts)
        .where(
          and(
            eq(expenditureBreakdownFacts.datasetVersionId, versionId),
            eq(expenditureBreakdownFacts.regionId, regionId),
            eq(expenditureBreakdownFacts.year, year),
          ),
        )
        .orderBy(asc(expenditureBreakdownFacts.expenditureType)),

    listNaturalResources: (versionId, regionId, year) =>
      db
        .select({
          resourceType: naturalResourceRevenueFacts.resourceType,
          budgetAmount: naturalResourceRevenueFacts.budgetAmount,
          realizationAmount: naturalResourceRevenueFacts.realizationAmount,
        })
        .from(naturalResourceRevenueFacts)
        .where(
          and(
            eq(naturalResourceRevenueFacts.datasetVersionId, versionId),
            eq(naturalResourceRevenueFacts.regionId, regionId),
            eq(naturalResourceRevenueFacts.year, year),
          ),
        )
        .orderBy(asc(naturalResourceRevenueFacts.resourceType)),

    listDisasters: (versionId, provinceId, year) =>
      db
        .select({
          disasterType: disasterFacts.disasterType,
          eventCount: disasterFacts.eventCount,
          deaths: disasterFacts.deaths,
          missing: disasterFacts.missing,
          affected: disasterFacts.affected,
        })
        .from(disasterFacts)
        .where(
          and(
            eq(disasterFacts.datasetVersionId, versionId),
            eq(disasterFacts.provinceId, provinceId),
            eq(disasterFacts.year, year),
          ),
        )
        .orderBy(asc(disasterFacts.disasterType)),

    listDisasterNotes: async (versionId, year) => {
      const rows = await db
        .select({ note: dataNotes.note })
        .from(dataNotes)
        .where(
          and(
            eq(dataNotes.datasetVersionId, versionId),
            eq(dataNotes.year, year),
            isNotNull(dataNotes.disasterType),
          ),
        )
        .orderBy(asc(dataNotes.id));
      return rows.map(({ note }) => note);
    },

    listSources: (versionId) =>
      db
        .select({
          publisher: dataSources.publisher,
          title: dataSources.title,
          sourceUrl: dataSources.sourceUrl,
          period: dataSources.period,
          downloadedAt: dataSources.downloadedAt,
        })
        .from(dataSources)
        .where(eq(dataSources.datasetVersionId, versionId))
        .orderBy(asc(dataSources.publisher)),

    listPublishedYears: async (versionId) => {
      const rows = await db
        .selectDistinct({ year: budgetFacts.year })
        .from(budgetFacts)
        .where(eq(budgetFacts.datasetVersionId, versionId))
        .orderBy(asc(budgetFacts.year));
      return rows.map(({ year }) => year);
    },

    listRegionBudgets: (versionId, year) =>
      db
        .select({
          code: regions.code,
          budgetAmount: budgetFacts.budgetAmount,
          realizationAmount: budgetFacts.realizationAmount,
        })
        .from(budgetFacts)
        .innerJoin(regions, eq(budgetFacts.regionId, regions.id))
        .where(and(eq(budgetFacts.datasetVersionId, versionId), eq(budgetFacts.year, year)))
        .orderBy(asc(regions.code)),

    countCoverage: async (versionId) => {
      const result = await db.execute<{
        provinces: string;
        regions: string;
        regions_with_budget: string;
      }>(sql`
        SELECT
          (SELECT count(*) FROM ${provinces})::text AS provinces,
          (SELECT count(*) FROM ${regions} WHERE ${regions.isActive})::text AS regions,
          (SELECT count(DISTINCT ${budgetFacts.regionId}) FROM ${budgetFacts}
            WHERE ${budgetFacts.datasetVersionId} = ${versionId})::text AS regions_with_budget
      `);
      const row = result.rows[0];
      return {
        provinces: Number(row?.provinces ?? 0),
        regions: Number(row?.regions ?? 0),
        regionsWithBudget: Number(row?.regions_with_budget ?? 0),
      };
    },
  };
}
