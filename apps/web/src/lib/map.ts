import type { MapRealizationItem } from '@jaga-daerah/contracts';

/** Pre-projected outlines from `tools/etl` (`jaga_etl.boundaries`), served as a static file. */
export interface MapGeometry {
  width: number;
  height: number;
  regions: { code: string; path: string; cx: number; cy: number }[];
  provinces: { code: string; path: string; box: [number, number, number, number] }[];
}

export const MAP_GEOMETRY_URL = '/data/map-regions.json';

function isGeometry(value: unknown): value is MapGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<MapGeometry>;
  return (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    Array.isArray(candidate.regions) &&
    Array.isArray(candidate.provinces) &&
    candidate.regions.every(
      (region) => typeof region.code === 'string' && typeof region.path === 'string',
    ) &&
    candidate.provinces.every(
      (province) =>
        typeof province.code === 'string' &&
        typeof province.path === 'string' &&
        Array.isArray(province.box) &&
        province.box.length === 4,
    )
  );
}

export async function loadMapGeometry(signal?: AbortSignal): Promise<MapGeometry> {
  const response = await fetch(MAP_GEOMETRY_URL, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error(`Peta tidak dapat dimuat (${response.status}).`);
  const body: unknown = await response.json();
  if (!isGeometry(body)) throw new Error('Berkas peta tidak valid.');
  return body;
}

/**
 * Map classes by distance from the national median, in percentage points. The scale is ordered
 * (light → dark = lower → higher realisation) rather than red/green: JagaDaerah shows official
 * figures without judging performance.
 */
export const MAP_CLASSES = [
  { key: 'far-below', label: 'Jauh di bawah median', hint: 'lebih dari 10 poin persen' },
  { key: 'below', label: 'Di bawah median', hint: '3–10 poin persen' },
  { key: 'near', label: 'Sekitar median', hint: 'selisih paling banyak 3 poin' },
  { key: 'above', label: 'Di atas median', hint: '3–10 poin persen' },
  { key: 'far-above', label: 'Jauh di atas median', hint: 'lebih dari 10 poin persen' },
  { key: 'none', label: 'Data belum tersedia', hint: 'tidak diwarnai' },
] as const;

export type MapClass = (typeof MAP_CLASSES)[number]['key'];

/** "89.8" → 898; percents are one-decimal strings, so tenths keep the comparison exact. */
function tenths(percent: string): number {
  const [whole = '0', fraction = '0'] = percent.split('.');
  return Number(whole) * 10 + Number(fraction);
}

export function classify(
  percent: string | null | undefined,
  medianPercent: string | null,
): MapClass {
  if (percent === null || percent === undefined || medianPercent === null) return 'none';
  const difference = tenths(percent) - tenths(medianPercent);
  if (difference < -100) return 'far-below';
  if (difference < -30) return 'below';
  if (difference <= 30) return 'near';
  if (difference <= 100) return 'above';
  return 'far-above';
}

export function countByClass(
  items: readonly MapRealizationItem[],
  medianPercent: string | null,
  codes: readonly string[],
): Record<MapClass, number> {
  const byCode = new Map(items.map((item) => [item.code, item.realization_percent]));
  const counts: Record<MapClass, number> = {
    'far-below': 0,
    below: 0,
    near: 0,
    above: 0,
    'far-above': 0,
    none: 0,
  };
  for (const code of codes) counts[classify(byCode.get(code), medianPercent)] += 1;
  return counts;
}

/** viewBox around a bounding box with breathing room, keeping a minimum size for tiny islands. */
export function viewBoxFor(
  box: readonly [number, number, number, number],
  padding = 0.08,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = box;
  const width = Math.max(x1 - x0, 24) * (1 + padding * 2);
  const height = Math.max(y1 - y0, 24) * (1 + padding * 2);
  return [(x0 + x1 - width) / 2, (y0 + y1 - height) / 2, width, height];
}
