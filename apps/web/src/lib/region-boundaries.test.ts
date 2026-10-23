import { describe, expect, test } from 'bun:test';

import { findRegionAt, parseRegionBoundaries } from './region-boundaries';
import type { RegionBoundary } from './region-boundaries';

// Two square regions around lon 100/lat 0, one with a hole in the middle.
const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: '11.01' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [99, -1],
            [101, -1],
            [101, 1],
            [99, 1],
            [99, -1],
          ],
          [
            [99.4, -0.2],
            [99.6, -0.2],
            [99.6, 0.2],
            [99.4, 0.2],
            [99.4, -0.2],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { code: '11.02' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [102, -1],
              [103, -1],
              [103, 1],
              [102, 1],
              [102, -1],
            ],
          ],
        ],
      },
    },
  ],
};

describe('parseRegionBoundaries', () => {
  test('reads Polygon and MultiPolygon features and computes boxes', () => {
    const boundaries = parseRegionBoundaries(GEOJSON);
    expect(boundaries.map((boundary) => boundary.code)).toEqual(['11.01', '11.02']);
    expect(boundaries[0]?.box).toEqual([99, -1, 101, 1]);
    expect(boundaries[1]?.box).toEqual([102, -1, 103, 1]);
  });

  test('rejects files without usable features', () => {
    expect(() => parseRegionBoundaries({})).toThrow('tidak valid');
    expect(() => parseRegionBoundaries({ type: 'FeatureCollection', features: [] })).toThrow(
      'tidak memuat daerah',
    );
  });

  test('skips features with an unknown geometry', () => {
    const boundaries = parseRegionBoundaries({
      features: [
        { properties: { code: '11.03' }, geometry: { type: 'Point', coordinates: [1, 2] } },
        ...GEOJSON.features,
      ],
    });
    expect(boundaries.map((boundary) => boundary.code)).toEqual(['11.01', '11.02']);
  });
});

describe('findRegionAt', () => {
  const boundaries = parseRegionBoundaries(GEOJSON);

  test('finds the region that contains the coordinate', () => {
    expect(findRegionAt(100, 0.5, boundaries)).toEqual({ code: '11.01', exact: true });
    expect(findRegionAt(102.5, 0, boundaries)).toEqual({ code: '11.02', exact: true });
  });

  test('treats a hole as outside the region', () => {
    const insideHole = findRegionAt(99.5, 0, boundaries);
    expect(insideHole?.exact).toBe(false);
  });

  test('falls back to the nearest region for a point just outside a boundary', () => {
    const match = findRegionAt(101.1, 0, boundaries);
    expect(match).toEqual({ code: '11.01', exact: false });
  });

  test('returns null far away from every boundary', () => {
    expect(findRegionAt(0, 0, boundaries)).toBeNull();
  });
});

describe('RegionBoundary shape', () => {
  test('exposes polygons as ring arrays', () => {
    const boundary: RegionBoundary | undefined = parseRegionBoundaries(GEOJSON)[0];
    expect(boundary?.polygons[0]?.[0]?.length).toBe(5);
  });
});
