// Locate the kabupaten/kota that contains a coordinate. Boundaries come from the same pinned
// GeoJSON file the map uses (lon/lat, not the pre-projected SVG). Loading happens only after the
// visitor asks for their location, and the coordinate never leaves the browser.

export const REGION_BOUNDARIES_URL = '/data/regions.geojson';

/** Longitude/latitude ring; the first and last points are usually equal. */
type Ring = readonly (readonly [number, number])[];
type Polygon = readonly Ring[];

export interface RegionBoundary {
  code: string;
  /** Polygon rings: the first ring is the outline, the rest are holes. */
  polygons: readonly Polygon[];
  box: readonly [number, number, number, number];
  center: readonly [number, number];
}

interface GeoJsonFeature {
  properties?: { code?: unknown };
  geometry?: { type?: unknown; coordinates?: unknown };
}

function isPosition(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

function isRing(value: unknown): value is Ring {
  return Array.isArray(value) && value.length >= 4 && value.every(isPosition);
}

function isPolygon(value: unknown): value is Polygon {
  return Array.isArray(value) && value.length >= 1 && value.every(isRing);
}

/** GeoJSON Polygon is [ring]; MultiPolygon is [[ring]]. Normalise to a list of polygons. */
function readPolygons(geometry: GeoJsonFeature['geometry']): readonly Polygon[] | null {
  if (geometry === undefined) return null;
  if (geometry.type === 'Polygon') {
    return isPolygon(geometry.coordinates) ? [geometry.coordinates] : null;
  }
  if (geometry.type === 'MultiPolygon') {
    const value = geometry.coordinates;
    return Array.isArray(value) && value.length > 0 && value.every(isPolygon) ? value : null;
  }
  return null;
}

function bounds(polygons: readonly Polygon[]): {
  box: [number, number, number, number];
  center: [number, number];
} {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return {
    box: [minLon, minLat, maxLon, maxLat],
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
  };
}

export function parseRegionBoundaries(value: unknown): RegionBoundary[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Berkas batas wilayah tidak valid.');
  }
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    throw new Error('Berkas batas wilayah tidak valid.');
  }

  const boundaries: RegionBoundary[] = [];
  for (const feature of features as GeoJsonFeature[]) {
    const code = feature.properties?.code;
    const polygons = readPolygons(feature.geometry);
    if (typeof code !== 'string' || code === '' || polygons === null) continue;
    boundaries.push({ code, polygons, ...bounds(polygons) });
  }
  if (boundaries.length === 0) {
    throw new Error('Berkas batas wilayah tidak memuat daerah.');
  }
  return boundaries;
}

/** Ray casting; points on an edge are treated as inside for practical reverse geocoding. */
function ringContains(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[current] ?? [0, 0];
    const [x2, y2] = ring[previous] ?? [0, 0];
    if (y1 > lat !== y2 > lat && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContains(lon: number, lat: number, polygon: readonly Ring[]): boolean {
  const [outer, ...holes] = polygon;
  if (outer === undefined || !ringContains(lon, lat, outer)) return false;
  return !holes.some((hole) => ringContains(lon, lat, hole));
}

/** Largest distance (degrees) at which a nearest-centre guess is still plausible. */
const NEAREST_LIMIT_DEGREES = 2.5;

export interface RegionMatch {
  code: string;
  /** True when the point is inside the boundary; false for a nearest-centre fallback. */
  exact: boolean;
}

export function findRegionAt(
  lon: number,
  lat: number,
  boundaries: readonly RegionBoundary[],
): RegionMatch | null {
  let nearest: RegionBoundary | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  const lonScale = Math.cos((lat * Math.PI) / 180);

  for (const boundary of boundaries) {
    const [minLon, minLat, maxLon, maxLat] = boundary.box;
    const insideBox = lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
    if (insideBox && boundary.polygons.some((polygon) => polygonContains(lon, lat, polygon))) {
      return { code: boundary.code, exact: true };
    }

    const dx = (lon - boundary.center[0]) * lonScale;
    const dy = lat - boundary.center[1];
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = boundary;
    }
  }

  if (nearest === null || nearestDistance > NEAREST_LIMIT_DEGREES ** 2) {
    return null;
  }
  return { code: nearest.code, exact: false };
}

export interface Coordinates {
  lon: number;
  lat: number;
}

let cached: Promise<RegionBoundary[]> | null = null;

export function loadRegionBoundaries(signal?: AbortSignal): Promise<RegionBoundary[]> {
  if (cached !== null) return cached;
  const request = fetch(REGION_BOUNDARIES_URL, signal === undefined ? {} : { signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Batas wilayah tidak dapat dimuat (${response.status}).`);
      }
      return response.json() as Promise<unknown>;
    })
    .then(parseRegionBoundaries)
    .catch((error: unknown) => {
      cached = null;
      throw error;
    });
  cached = request;
  return request;
}

export function currentCoordinates(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      reject(new Error('Perangkat ini tidak mendukung lokasi.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lon: position.coords.longitude, lat: position.coords.latitude }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  });
}
