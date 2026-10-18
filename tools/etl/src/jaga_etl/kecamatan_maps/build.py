"""Turn kecamatan boundary dumps into one pre-projected map file per kabupaten/kota.

Output (`<regionCode>.json`):
  { "code", "width", "height", "projection": {west, north, scale, cos_lat}, "outline",
    "kecamatan": [{code, name, path, cx, cy}] }

Projection (per region, fitted to the region's own bounding box):
  x = (lon - west) * scale * cos_lat
  y = (north - lat) * scale
where `cos_lat` is the cosine of the box's middle latitude and `scale` is chosen so the box is
exactly `WIDTH` px wide; `height` is the box height in px, rounded up. The browser can place any
other point (a marker, a station) with the same four numbers. Paths are simplified with
Douglas–Peucker in projected px and rounded to one decimal: for display only, not legal boundaries.

Names come from the Kemendagri list (cahyadsn/wilayah), joined strictly by code; the boundary
file's own name column is ignored.
"""

import math
import re
from collections import Counter
from dataclasses import dataclass

from jaga_etl.boundaries.build import ROW, Boundary, _area, parse, simplify, to_path
from jaga_etl.regions.normalize import VALUE_TUPLE, normalize_name

WIDTH = 600
TOLERANCE_PX = 0.6
# Keep every island that survives simplification with a real area; only collapsed slivers go.
MIN_RING_AREA_PX = 1e-6
KECAMATAN_CODE = re.compile(r"\d{2}\.\d{2}\.\d{2}")


@dataclass(frozen=True)
class RegionProjection:
    west: float
    north: float
    scale: float
    cos_lat: float

    def __call__(self, lat: float, lng: float) -> tuple[float, float]:
        return ((lng - self.west) * self.scale * self.cos_lat, (self.north - lat) * self.scale)


class GateError(Exception):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


def kecamatan_names(wilayah_dump: str) -> dict[str, str]:
    """Kemendagri kecamatan code → name from the pinned wilayah dump (parsed as text)."""
    names: dict[str, str] = {}
    for match in VALUE_TUPLE.finditer(wilayah_dump):
        code = match.group("code")
        if KECAMATAN_CODE.fullmatch(code):
            names[code] = normalize_name(match.group("name"))
    return names


def parse_kecamatan(dumps: list[str]) -> tuple[dict[str, Boundary], list[str]]:
    """Kecamatan boundaries plus any code that appears more than once (which the gate rejects)."""
    counts: Counter[str] = Counter()
    boundaries: dict[str, Boundary] = {}
    for dump in dumps:
        counts.update(m.group("code") for m in ROW.finditer(dump) if KECAMATAN_CODE.fullmatch(m.group("code")))
        boundaries.update(parse(dump, KECAMATAN_CODE))
    return boundaries, sorted(code for code, count in counts.items() if count > 1)


def fit_projection(boundaries: list[Boundary]) -> tuple[RegionProjection, int]:
    lats = [p[0] for b in boundaries for poly in b.polygons for ring in poly for p in ring]
    lngs = [p[1] for b in boundaries for poly in b.polygons for ring in poly for p in ring]
    west, east, south, north = min(lngs), max(lngs), min(lats), max(lats)
    cos_lat = round(math.cos(math.radians((south + north) / 2)), 8)
    scale = round(WIDTH / ((east - west) * cos_lat), 4)
    projection = RegionProjection(round(west, 6), round(north, 6), scale, cos_lat)
    return projection, max(1, math.ceil((north - south) * scale))


def _widest_span(rings: list[list[tuple[float, float]]], y: float) -> tuple[float, float] | None:
    """(midpoint x, width) of the widest inside span of scanline `y`, even-odd over all rings."""
    xs: list[float] = []
    for ring in rings:
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    xs.sort()
    spans = [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]
    if not spans:
        return None
    left, right = max(spans, key=lambda span: span[1] - span[0])
    return ((left + right) / 2, right - left)


def label_point(boundary: Boundary, project: RegionProjection) -> tuple[float, float]:
    """A point inside the largest polygon (holes respected): middle of its widest scanline span.

    Several scanlines are tried so a C-shaped or hooked polygon still gets a point well inside it.
    """
    # Simplified like the drawn path, so the label lands inside the shape the browser renders.
    polygons = [
        [simplify([project(lat, lng) for lat, lng in ring], TOLERANCE_PX) for ring in polygon]
        for polygon in boundary.polygons
    ]
    largest = max(polygons, key=lambda polygon: _area(polygon[0]))
    ys = [y for _, y in largest[0]]
    top, bottom = min(ys), max(ys)
    best: tuple[float, float, float] | None = None  # (width, x, y)
    for fraction in (0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8):
        y = top + (bottom - top) * fraction
        span = _widest_span(largest, y)
        if span is not None and (best is None or span[1] > best[0]):
            best = (span[1], span[0], y)
    if best is None:
        return project(boundary.lat, boundary.lng)
    return best[1], best[2]


def check_coverage(
    region_codes: list[str],
    names: dict[str, str],
    boundaries: dict[str, Boundary],
    duplicates: list[str],
    outlines: dict[str, Boundary],
) -> None:
    """Strict code join: every listed kecamatan has a boundary and every boundary is listed."""
    problems: list[str] = []
    if len(set(region_codes)) != len(region_codes):
        problems.append("duplicate region codes in the region list")
    if duplicates:
        problems.append(f"duplicate kecamatan boundary codes {duplicates}")
    regions = set(region_codes)
    missing = sorted(code for code in names if code[:5] in regions and code not in boundaries)
    unknown = sorted(code for code in boundaries if code not in names)
    if missing:
        problems.append(f"{len(missing)} kecamatan without a boundary {missing}")
    if unknown:
        problems.append(f"{len(unknown)} boundary codes not in the Kemendagri list {unknown}")
    outside = sorted(code for code in boundaries if code[:5] not in regions)
    if outside:
        problems.append(f"{len(outside)} boundary codes outside the region list {outside}")
    empty = sorted(code for code in regions if not any(name[:5] == code for name in names))
    if empty:
        problems.append(f"regions with no kecamatan in the Kemendagri list {empty}")
    no_outline = sorted(regions - set(outlines))
    if no_outline:
        problems.append(f"regions without an outline {no_outline}")
    if problems:
        raise GateError(problems)


def build_region(
    code: str, kecamatan: list[Boundary], names: dict[str, str], outline: Boundary
) -> dict[str, object]:
    projection, height = fit_projection([*kecamatan, outline])
    if not all(math.isfinite(v) and v > 0 for v in (projection.scale, projection.cos_lat)):
        raise GateError([f"{code}: projection is not finite"])
    outline_path, _ = to_path(outline, projection, tolerance=TOLERANCE_PX, min_area=MIN_RING_AREA_PX)
    entries = []
    for boundary in kecamatan:
        path, _ = to_path(boundary, projection, tolerance=TOLERANCE_PX, min_area=MIN_RING_AREA_PX)
        cx, cy = label_point(boundary, projection)
        if not path.startswith("M") or not (math.isfinite(cx) and math.isfinite(cy)):
            raise GateError([f"{boundary.code}: empty path or non-finite label point"])
        entries.append(
            {"code": boundary.code, "name": names[boundary.code], "path": path, "cx": round(cx, 1), "cy": round(cy, 1)}
        )
    entries.sort(key=lambda entry: (str(entry["name"]), str(entry["code"])))
    return {
        "code": code,
        "width": WIDTH,
        "height": height,
        "projection": {
            "west": projection.west,
            "north": projection.north,
            "scale": projection.scale,
            "cos_lat": projection.cos_lat,
        },
        "outline": outline_path,
        "kecamatan": entries,
    }


def build_all(
    region_codes: list[str],
    names: dict[str, str],
    boundaries: dict[str, Boundary],
    duplicates: list[str],
    outlines: dict[str, Boundary],
) -> dict[str, dict[str, object]]:
    check_coverage(region_codes, names, boundaries, duplicates, outlines)
    by_region: dict[str, list[Boundary]] = {code: [] for code in region_codes}
    for boundary in boundaries.values():
        by_region[boundary.code[:5]].append(boundary)
    return {code: build_region(code, by_region[code], names, outlines[code]) for code in sorted(region_codes)}
