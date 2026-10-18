import type { Province, RegionSummary } from '@jaga-daerah/contracts';

import type { ReferenceRepository } from '#api/repositories/reference-repository';

const REGION_CODE_PATTERN = /^[0-9]{2}\.[0-9]{2}$/;

export type ProvinceRegionsResult =
  | {
      kind: 'found';
      province: Province;
      items: Omit<RegionSummary, 'province'>[];
      nextCursor: string | null;
    }
  | { kind: 'province-not-found' }
  | { kind: 'invalid-cursor' };

// Cursors are opaque to clients: base64url of the last region code on the previous page.
export function encodeRegionCursor(regionCode: string): string {
  return btoa(regionCode).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeRegionCursor(cursor: string): string | undefined {
  try {
    const decoded = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'));
    return REGION_CODE_PATTERN.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

export async function listProvinces(repository: ReferenceRepository): Promise<Province[]> {
  const rows = await repository.listProvinces();
  return rows.map(({ code, name, slug }) => ({ code, name, slug }));
}

export async function listProvinceRegions(
  repository: ReferenceRepository,
  params: { provinceCode: string; cursor: string | undefined; limit: number },
): Promise<ProvinceRegionsResult> {
  let afterCode: string | undefined;
  if (params.cursor !== undefined) {
    afterCode = decodeRegionCursor(params.cursor);
    if (afterCode === undefined) {
      return { kind: 'invalid-cursor' };
    }
  }

  const province = await repository.findProvinceByCode(params.provinceCode);
  if (province === undefined) {
    return { kind: 'province-not-found' };
  }

  // Fetch one extra row to learn whether another page exists without a count query.
  const rows = await repository.listActiveRegionsInProvince({
    provinceId: province.id,
    afterCode,
    limit: params.limit + 1,
  });
  const items = rows.slice(0, params.limit);
  const lastItem = items.at(-1);

  return {
    kind: 'found',
    province: { code: province.code, name: province.name, slug: province.slug },
    items,
    nextCursor:
      rows.length > params.limit && lastItem !== undefined
        ? encodeRegionCursor(lastItem.code)
        : null,
  };
}

export function searchRegions(
  repository: ReferenceRepository,
  params: { query: string; limit: number },
): Promise<RegionSummary[]> {
  return repository.searchActiveRegions({ term: params.query.toLowerCase(), limit: params.limit });
}
