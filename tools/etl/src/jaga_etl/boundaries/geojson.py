"""GeoJSON outlines for the MapLibre choropleth.

The SVG map file is pre-projected and cannot sit on a CARTO basemap. This writes
longitude/latitude polygons from the same pinned boundary snapshot, simplified in
degrees so the file stays small enough to ship.
"""

import json
import re
import sys
from pathlib import Path

from jaga_etl.boundaries.__main__ import snapshot
from jaga_etl.boundaries.build import Boundary, parse, simplify
from jaga_etl.boundaries.source import COMMIT
from jaga_etl.http import PoliteFetcher
from jaga_etl.snapshot import read_snapshot

# About 1.3 km at the equator. Coastlines stay recognisable when the map is zoomed.
TOLERANCE_DEG = 0.012
# Drop islets smaller than this in square degrees. A missing ring falls back to a point marker.
MIN_RING_AREA_DEG = 0.00004
ETL_ROOT = Path(__file__).resolve().parents[3]
REGION_CODE = re.compile(r"\d{2}\.\d{2}")
PROVINCE_CODE = re.compile(r"\d{2}")
LngLat = tuple[float, float]


def _area(points: list[LngLat]) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1], strict=False))) / 2


def _ring(points: list[tuple[float, float]]) -> list[list[float]] | None:
    """Source points are (lat, lng). GeoJSON rings are [lng, lat] and must be closed."""
    simplified = simplify([(lng, lat) for lat, lng in points], TOLERANCE_DEG)
    if len(simplified) < 3 or _area(simplified) < MIN_RING_AREA_DEG:
        return None
    ring = [[round(lng, 5), round(lat, 5)] for lng, lat in simplified]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    if len(ring) < 4:
        return None
    return ring


def feature(boundary: Boundary) -> dict[str, object]:
    polygons: list[list[list[list[float]]]] = []
    for polygon in boundary.polygons:
        rings = [ring for ring in (_ring(raw) for raw in polygon) if ring is not None]
        if rings:
            polygons.append(rings)
    if not polygons:
        lng, lat = round(boundary.lng, 5), round(boundary.lat, 5)
        delta = 0.02
        polygons.append(
            [[[lng - delta, lat - delta], [lng + delta, lat - delta], [lng + delta, lat + delta], [lng - delta, lat + delta], [lng - delta, lat - delta]]]
        )
    return {
        "type": "Feature",
        "id": boundary.code,
        "properties": {"code": boundary.code},
        "geometry": {"type": "MultiPolygon", "coordinates": polygons},
    }


def collection(boundaries: dict[str, Boundary]) -> dict[str, object]:
    return {
        "type": "FeatureCollection",
        "source": {
            "repository": "https://github.com/cahyadsn/wilayah_boundaries",
            "commit": COMMIT,
            "license": "MIT",
            "codes": "Kepmendagri No. 300.2.2-2430 Tahun 2025",
        },
        "features": [feature(boundaries[code]) for code in sorted(boundaries)],
    }


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ETL_ROOT.parents[1] / "apps" / "web" / "public" / "data" / "regions.geojson"
    directory = ETL_ROOT / "data" / "raw" / "boundaries" / COMMIT[:12]
    if not (directory / "manifest.json").exists():
        snapshot(PoliteFetcher(delay_seconds=0.2, max_bytes=20 * 1024 * 1024))
    contents = read_snapshot(directory)[1]
    regions: dict[str, Boundary] = {}
    provinces: dict[str, Boundary] = {}
    for name, content in contents.items():
        text = content.decode("utf-8")
        if name.startswith("kab_"):
            regions.update(parse(text, REGION_CODE))
        elif name.startswith("prov_"):
            provinces.update(parse(text, PROVINCE_CODE))
    payload = collection(regions)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"regions": len(regions), "provinces": len(provinces), "bytes": output.stat().st_size}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
