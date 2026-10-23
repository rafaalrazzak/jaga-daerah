// Most-recently-opened regions, kept in localStorage only. This is a UI convenience, not user
// data sent anywhere; parsing is defensive because another tab or an older version may have
// written a different shape.

export interface RecentRegion {
  code: string;
  name: string;
  slug: string;
  provinceName: string;
}

export const RECENT_REGIONS_KEY = 'jaga-daerah:recent-regions';
export const RECENT_REGIONS_LIMIT = 5;

function isRecentRegion(value: unknown): value is RecentRegion {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RecentRegion>;
  return (
    typeof entry.code === 'string' &&
    entry.code !== '' &&
    typeof entry.name === 'string' &&
    entry.name !== '' &&
    typeof entry.slug === 'string' &&
    entry.slug !== '' &&
    typeof entry.provinceName === 'string'
  );
}

export function parseRecentRegions(raw: string | null): RecentRegion[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentRegion).slice(0, RECENT_REGIONS_LIMIT);
}

export function addRecentRegion(
  list: readonly RecentRegion[],
  item: RecentRegion,
  limit = RECENT_REGIONS_LIMIT,
): RecentRegion[] {
  return [item, ...list.filter((entry) => entry.code !== item.code)].slice(0, limit);
}

export function readRecentRegions(storage: Pick<Storage, 'getItem'>): RecentRegion[] {
  try {
    return parseRecentRegions(storage.getItem(RECENT_REGIONS_KEY));
  } catch {
    return [];
  }
}

export function writeRecentRegions(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  list: readonly RecentRegion[],
): void {
  try {
    if (list.length === 0) {
      storage.removeItem(RECENT_REGIONS_KEY);
    } else {
      storage.setItem(RECENT_REGIONS_KEY, JSON.stringify(list));
    }
  } catch {
    // Private mode or a full quota: remembering searches is optional, so fail silently.
  }
}
