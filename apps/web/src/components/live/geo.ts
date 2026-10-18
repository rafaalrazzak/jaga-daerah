import { KecamatanMapSchema } from '@jaga-daerah/contracts';
import type { Hotspot, KecamatanMap } from '@jaga-daerah/contracts';

export async function loadKecamatanMap(code: string, signal: AbortSignal): Promise<KecamatanMap> {
  const response = await fetch(`/data/kecamatan/${code}.json`, { signal });
  if (!response.ok) throw new Error(`Peta kecamatan ${code} tidak tersedia.`);
  return KecamatanMapSchema.parse(await response.json());
}

/** Map coordinates for a latitude/longitude, using the file's own projection. */
export function project(map: KecamatanMap, latitude: number, longitude: number) {
  const { west, north, scale, cos_lat: cos } = map.projection;
  return { x: (longitude - west) * scale * cos, y: (north - latitude) * scale };
}

export interface LocatedHotspot extends Hotspot {
  x: number;
  y: number;
  kecamatan: string;
}

export interface HotspotDistribution {
  items: LocatedHotspot[];
  count: number;
  highConfidence: number;
  /** Kecamatan with at least one detection, most detections first. */
  byKecamatan: { name: string; count: number }[];
}

/**
 * Keeps only the detections that fall inside one of the region's kecamatan outlines, and names
 * that kecamatan. The server filters by bounding box only, which can include sea or a neighbouring
 * regency. Returns null where the browser cannot test points (no Path2D), so callers fall back to
 * the server's box count and say so.
 */
export function distributeHotspots(
  map: KecamatanMap,
  hotspots: readonly Hotspot[],
): HotspotDistribution | null {
  if (typeof Path2D === 'undefined' || typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  if (context === null) return null;
  const shapes = map.kecamatan.map((kecamatan) => ({
    name: kecamatan.name,
    path: new Path2D(kecamatan.path),
  }));

  const items: LocatedHotspot[] = [];
  for (const spot of hotspots) {
    const { x, y } = project(map, spot.latitude, spot.longitude);
    const shape = shapes.find((candidate) => context.isPointInPath(candidate.path, x, y));
    if (shape !== undefined) items.push({ ...spot, x, y, kecamatan: shape.name });
  }

  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kecamatan, (counts.get(item.kecamatan) ?? 0) + 1);
  return {
    items,
    count: items.length,
    highConfidence: items.filter((item) => item.confidence === 'high').length,
    byKecamatan: [...counts]
      .map(([name, count]) => ({ name, count }))
      .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
  };
}
