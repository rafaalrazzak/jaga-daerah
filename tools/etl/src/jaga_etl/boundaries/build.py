"""Turn boundary SQL dumps into a compact, pre-projected map file for the web.

Output (`map-regions.json`):
  { "width", "height", "regions": [{code, path, cx, cy}], "provinces": [{code, path, box}] }

Paths are SVG path strings in a fixed viewBox, so the browser draws the map without a geo library
or any third-party tile service. Projection: equirectangular scaled by cos(central latitude), which
is close to conformal at Indonesia's latitudes. Simplification: Douglas–Peucker in screen space.
"""

import json
import math
import re
from dataclasses import dataclass

ROW = re.compile(
    r"\(\s*'(?P<code>[0-9.]+)'\s*,\s*'(?P<name>(?:[^'\\]|\\.|'')*)'\s*,\s*(?P<lat>-?[0-9.]+)\s*,"
    r"\s*(?P<lng>-?[0-9.]+)\s*,\s*'(?P<path>\[[^']*\])'\s*\)"
)
WIDTH = 1200.0
TOLERANCE_PX = 0.6
MIN_RING_AREA_PX = 1.5  # drop specks (tiny islets) that would render below one pixel

Point = tuple[float, float]  # (lat, lng) in source order
Ring = list[Point]


@dataclass(frozen=True)
class Boundary:
    code: str
    name: str
    lat: float
    lng: float
    polygons: list[list[Ring]]  # polygon → rings → points


def _as_polygons(raw: object) -> list[list[Ring]]:
    """Normalize polygon ([[pt]]) or multipolygon ([[[pt]]]) nesting into a list of polygons."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("empty geometry")

    def depth(value: object) -> int:
        level = 0
        while isinstance(value, list) and value:
            value = value[0]
            level += 1
        return level

    level = depth(raw)
    if level == 3:  # polygon: rings → points → [lat, lng]
        polygons = [raw]
    elif level == 4:  # multipolygon
        polygons = raw
    else:
        raise ValueError(f"unexpected nesting depth {level}")
    return [[[(float(p[0]), float(p[1])) for p in ring] for ring in polygon] for polygon in polygons]


def parse(dump: str, code_pattern: re.Pattern[str]) -> dict[str, Boundary]:
    boundaries: dict[str, Boundary] = {}
    for match in ROW.finditer(dump):
        code = match.group("code")
        if not code_pattern.fullmatch(code):
            continue
        boundaries[code] = Boundary(
            code=code,
            name=match.group("name"),
            lat=float(match.group("lat")),
            lng=float(match.group("lng")),
            polygons=_as_polygons(json.loads(match.group("path"))),
        )
    return boundaries


def _perpendicular(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    (x, y), (x1, y1), (x2, y2) = point, start, end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Iterative Douglas–Peucker (no recursion limit on long coastlines)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        index, distance = -1, tolerance
        for i in range(first + 1, last):
            d = _perpendicular(points[i], points[first], points[last])
            if d > distance:
                index, distance = i, d
        if index != -1:
            keep[index] = True
            stack.extend([(first, index), (index, last)])
    return [point for point, kept in zip(points, keep, strict=True) if kept]


def _area(points: list[tuple[float, float]]) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]))) / 2


class Projection:
    def __init__(self, boundaries: list[Boundary]) -> None:
        lats = [p[0] for b in boundaries for poly in b.polygons for ring in poly for p in ring]
        lngs = [p[1] for b in boundaries for poly in b.polygons for ring in poly for p in ring]
        self.min_lng, self.max_lng = min(lngs), max(lngs)
        self.min_lat, self.max_lat = min(lats), max(lats)
        self.kx = math.cos(math.radians((self.min_lat + self.max_lat) / 2))
        self.scale = WIDTH / ((self.max_lng - self.min_lng) * self.kx)
        self.height = (self.max_lat - self.min_lat) * self.scale

    def __call__(self, lat: float, lng: float) -> tuple[float, float]:
        return ((lng - self.min_lng) * self.kx * self.scale, (self.max_lat - lat) * self.scale)


def to_path(boundary: Boundary, project: Projection) -> tuple[str, list[float]]:
    """SVG path (one decimal) and bounding box [x0, y0, x1, y1] after simplification."""
    commands: list[str] = []
    xs: list[float] = []
    ys: list[float] = []
    for polygon in boundary.polygons:
        for ring in polygon:
            points = simplify([project(lat, lng) for lat, lng in ring], TOLERANCE_PX)
            if len(points) < 3 or _area(points) < MIN_RING_AREA_PX:
                continue
            commands.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in points) + "Z")
            xs.extend(x for x, _ in points)
            ys.extend(y for _, y in points)
    if not commands:
        # Keep very small regions visible as a dot-sized square at their centroid.
        x, y = project(boundary.lat, boundary.lng)
        commands.append(f"M{x - 1.5:.1f},{y - 1.5:.1f}h3v3h-3Z")
        xs, ys = [x - 1.5, x + 1.5], [y - 1.5, y + 1.5]
    return "".join(commands), [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


def build_map(regions: dict[str, Boundary], provinces: dict[str, Boundary]) -> dict[str, object]:
    project = Projection(list(provinces.values()) or list(regions.values()))
    region_entries = []
    for code, boundary in sorted(regions.items()):
        path, _ = to_path(boundary, project)
        cx, cy = project(boundary.lat, boundary.lng)
        region_entries.append({"code": code, "path": path, "cx": round(cx, 1), "cy": round(cy, 1)})
    province_entries = []
    for code, boundary in sorted(provinces.items()):
        path, box = to_path(boundary, project)
        province_entries.append({"code": code, "path": path, "box": box})
    return {
        "width": round(WIDTH, 1),
        "height": round(project.height, 1),
        "regions": region_entries,
        "provinces": province_entries,
    }
