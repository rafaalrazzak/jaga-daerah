import { and, asc, eq, gt, like, or, sql } from 'drizzle-orm';

import type { Database } from '#api/db/client';
import { provinces, regions } from '#api/db/schema/index';

export interface ProvinceRecord {
  id: number;
  code: string;
  name: string;
  slug: string;
}

export interface RegionRecord {
  code: string;
  name: string;
  slug: string;
  type: 'kabupaten' | 'kota';
}

export interface RegionWithProvinceRecord extends RegionRecord {
  province: Omit<ProvinceRecord, 'id'>;
}

export interface ReferenceRepository {
  listProvinces(): Promise<ProvinceRecord[]>;
  findProvinceByCode(code: string): Promise<ProvinceRecord | undefined>;
  listActiveRegionsInProvince(params: RegionsInProvinceParams): Promise<RegionRecord[]>;
  searchActiveRegions(params: RegionSearchParams): Promise<RegionWithProvinceRecord[]>;
}

export interface RegionsInProvinceParams {
  provinceId: number;
  afterCode: string | undefined;
  limit: number;
}

export interface RegionSearchParams {
  /** Must already be lowercased and free of LIKE wildcards (enforced by the contract). */
  term: string;
  limit: number;
}

const PROVINCE_COLUMNS = {
  id: provinces.id,
  code: provinces.code,
  name: provinces.name,
  slug: provinces.slug,
};

const REGION_COLUMNS = {
  code: regions.code,
  name: regions.name,
  slug: regions.slug,
  type: regions.type,
};

// Query builders are exported so integration tests can EXPLAIN the exact SQL the API runs.
export function regionsInProvinceQuery(db: Database, params: RegionsInProvinceParams) {
  return db
    .select(REGION_COLUMNS)
    .from(regions)
    .where(
      and(
        eq(regions.provinceId, params.provinceId),
        eq(regions.isActive, true),
        params.afterCode === undefined ? undefined : gt(regions.code, params.afterCode),
      ),
    )
    .orderBy(asc(regions.code))
    .limit(params.limit);
}

export function regionSearchQuery(db: Database, { term, limit }: RegionSearchParams) {
  const prefix = `${term}%`;
  const nameLower = sql<string>`lower(${regions.name})`;

  return (
    db
      .select({
        ...REGION_COLUMNS,
        provinceCode: provinces.code,
        provinceName: provinces.name,
        provinceSlug: provinces.slug,
      })
      .from(regions)
      .innerJoin(provinces, eq(regions.provinceId, provinces.id))
      .where(
        and(
          eq(regions.isActive, true),
          or(like(regions.searchName, prefix), like(nameLower, prefix)),
        ),
      )
      // Drizzle has no CASE builder; this parameterized fragment ranks exact matches first,
      // then prefixes of the bare name ("bandung"), then prefixes of the full name ("kota b").
      .orderBy(
        sql`CASE
          WHEN ${regions.searchName} = ${term} OR ${nameLower} = ${term} THEN 0
          WHEN ${regions.searchName} LIKE ${prefix} THEN 1
          ELSE 2
        END`,
        asc(regions.searchName),
        asc(regions.code),
      )
      .limit(limit)
  );
}

export function createReferenceRepository(db: Database): ReferenceRepository {
  return {
    listProvinces: () => db.select(PROVINCE_COLUMNS).from(provinces).orderBy(asc(provinces.code)),

    findProvinceByCode: async (code) => {
      const [province] = await db
        .select(PROVINCE_COLUMNS)
        .from(provinces)
        .where(eq(provinces.code, code))
        .limit(1);
      return province;
    },

    listActiveRegionsInProvince: (params) => regionsInProvinceQuery(db, params),

    searchActiveRegions: async (params) => {
      const rows = await regionSearchQuery(db, params);
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        slug: row.slug,
        type: row.type,
        province: { code: row.provinceCode, name: row.provinceName, slug: row.provinceSlug },
      }));
    },
  };
}
