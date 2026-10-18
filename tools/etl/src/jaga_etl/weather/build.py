"""Turn the sealed BMKG normal-rainfall responses into one climatology record per region.

The source is a raster product, not a per-region table, so every region gets ONE sample point and
the value read from that point. The points are reviewed data, not a silent name join: they live in
`reference/weather-sample-points.csv`, one row per Kemendagri code, each with the method that
produced it. The gate re-checks every point against the sealed boundary snapshot, so a point that
does not fall inside the region it is attached to blocks the build instead of publishing a value
that belongs to a neighbour.

What the figure means, and what it does not: it is the long-term (1981–2010) mean rainfall for the
raster cell under that point — a climatological normal, not current weather and not a forecast.
A point sample approximates a whole kabupaten/kota; a region spanning a coastal plain and a mountain
range has one value for both, so the published label names the point and calls the value an
approximation rather than an areal average.
"""

import csv
import json
import math
from dataclasses import dataclass
from pathlib import Path

from jaga_etl.boundaries.build import Boundary
from jaga_etl.snapshot import Manifest
from jaga_etl.weather.source import MONTHS, MONTH_LAYERS, identify_url

MONTH_NAMES = (
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
)
SAMPLE_METHODS = ("centroid", "interior")
# The raster's own no-data marker, and the attribute name ArcGIS identify uses for a cell's value.
NO_DATA = "NoData"
VALUE_FIELD = "Pixel Value"
# One snapshot file per region; the fetch and the gate both derive it here so they cannot drift.
FILE_TEMPLATE = "region-{code}.json"


class QualityGateError(Exception):
    """Raised with every problem found, so one run reports all of them instead of the first."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__(f"Weather quality gate failed ({len(problems)} problem(s)): " + "; ".join(problems[:5]))


@dataclass(frozen=True)
class SamplePoint:
    code: str
    latitude: float
    longitude: float
    method: str
    note: str


def ring_area(ring: list[tuple[float, float]]) -> float:
    return abs(
        sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True))
    ) / 2


def ring_centroid(ring: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Area centroid `(latitude, longitude)` of a ring, or None for a degenerate ring.

    Ring points are `(latitude, longitude)`, so the accumulated x terms are latitudes and the y terms
    longitudes; the result is returned in the same order as the input points.
    """
    area = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1], strict=True):
        cross = x1 * y2 - x2 * y1
        area += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if area == 0:
        return None
    return (cx / (3 * area), cy / (3 * area))


def inside(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    """Even-odd point-in-ring test in (latitude, longitude) space."""
    latitude, longitude = point
    result = False
    for index in range(len(ring)):
        y1, x1 = ring[index]
        y2, x2 = ring[(index + 1) % len(ring)]
        if (x1 > longitude) != (x2 > longitude):
            slope = (longitude - x1) / (x2 - x1)
            if latitude < y1 + slope * (y2 - y1):
                result = not result
    return result


def _outer_rings(boundary: Boundary) -> list[list[tuple[float, float]]]:
    """Outer ring of every polygon, largest first: coastline joins may split one region."""
    rings = []
    for polygon in boundary.polygons:
        outer = [(float(point[0]), float(point[1])) for point in polygon[0]]
        if len(outer) >= 4:
            rings.append(outer)
    return sorted(rings, key=ring_area, reverse=True)


def candidate_points(boundary: Boundary) -> list[tuple[tuple[float, float], str]]:
    """Sample-point candidates in preference order, largest polygon first.

    The area centroid is tried first: for most kabupaten/kota it lands inside the region and is the
    most representative single point. It falls outside crescents, horseshoes and multi-island
    geometry, so an interior candidate is found by scanning the ring's bounding box in a small grid
    and keeping the inside point nearest that centroid — deterministic, cheap, and never empty for a
    ring with any area. Further grid points follow so a `NoData` cell can be stepped around.
    """
    candidates: list[tuple[tuple[float, float], str]] = []
    seen: set[tuple[float, float]] = set()

    def offer(position: tuple[float, float], method: str) -> None:
        key = (round(position[0], 6), round(position[1], 6))
        if key not in seen:
            seen.add(key)
            candidates.append((position, method))

    for ring in _outer_rings(boundary)[:6]:
        centroid = ring_centroid(ring)
        if centroid is not None and inside(centroid, ring):
            offer(centroid, "centroid")
        origin = centroid if centroid is not None else ring[0]
        for position in _interior_points(ring, origin):
            offer(position, "interior")
    return candidates[:12]


def _interior_points(ring: list[tuple[float, float]], reference: tuple[float, float]) -> list[tuple[float, float]]:
    """Inside points of `ring`, nearest to `reference` first, found by a bounded grid scan."""
    latitudes = [point[0] for point in ring]
    longitudes = [point[1] for point in ring]
    steps = 16
    lat_step = (max(latitudes) - min(latitudes)) / (steps + 1)
    lng_step = (max(longitudes) - min(longitudes)) / (steps + 1)
    if lat_step == 0 or lng_step == 0:
        return []
    found: list[tuple[float, tuple[float, float]]] = []
    for row in range(1, steps + 1):
        for column in range(1, steps + 1):
            position = (min(latitudes) + row * lat_step, min(longitudes) + column * lng_step)
            if inside(position, ring):
                found.append((abs(position[0] - reference[0]) + abs(position[1] - reference[1]), position))
    found.sort(key=lambda item: item[0])
    return [position for _, position in found[:5]]


def propose_points(regions: dict[str, Boundary]) -> dict[str, SamplePoint]:
    """First candidate for every region: the point the reference file is reviewed from."""
    proposed: dict[str, SamplePoint] = {}
    for code, boundary in regions.items():
        candidates = candidate_points(boundary)
        if not candidates:
            continue
        (latitude, longitude), method = candidates[0]
        proposed[code] = SamplePoint(
            code=code,
            latitude=round(latitude, 6),
            longitude=round(longitude, 6),
            method=method,
            note="titik sampel di dalam poligon terbesar kabupaten/kota" if method == "centroid" else "titik di dalam poligon (centroid di luar wilayah)",
        )
    return proposed


def read_reference(path: Path) -> dict[str, SamplePoint]:
    points: dict[str, SamplePoint] = {}
    with path.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            code = row["code"].strip()
            points[code] = SamplePoint(
                code=code,
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                method=row["method"].strip(),
                note=row["note"].strip(),
            )
    return points


def write_reference(path: Path, points: dict[str, SamplePoint]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        file.write("code,latitude,longitude,method,note\n")
        for code in sorted(points):
            point = points[code]
            file.write(
                f"{code},{point.latitude:.6f},{point.longitude:.6f},{point.method},{point.note}\n"
            )


def parse_identify(content: bytes) -> dict[int, float | None]:
    """Monthly values keyed by the source's month layer id; `NoData` and absent layers stay None."""
    payload = json.loads(content.decode("utf-8"))
    if "error" in payload:
        raise ValueError(f"identify returned an error: {payload['error']}")
    layers: dict[int, float | None] = {}
    for result in payload.get("results", []):
        layer = result.get("layerId")
        if layer is None:
            continue
        value = result.get("attributes", {}).get(VALUE_FIELD)
        if value is None or value == NO_DATA:
            layers[int(layer)] = None
        else:
            layers[int(layer)] = float(value)
    return layers


def check_points(
    reference: dict[str, SamplePoint], regions: dict[str, Boundary], expected: set[str]
) -> list[str]:
    """Every published region needs one reviewed point that is actually inside that region."""
    problems: list[str] = []
    if set(reference) != expected:
        problems.append(
            "sample points do not match the region reference: "
            f"missing={sorted(expected - set(reference))[:8]} extra={sorted(set(reference) - expected)[:8]}"
        )
    seen: dict[tuple[float, float], str] = {}
    for code in sorted(set(reference) & set(regions)):
        point = reference[code]
        if point.method not in SAMPLE_METHODS:
            problems.append(f"{code}: unknown sample method {point.method!r}")
        if not (math.isfinite(point.latitude) and math.isfinite(point.longitude)):
            problems.append(f"{code}: sample point is not finite")
            continue
        key = (point.latitude, point.longitude)
        if key in seen:
            problems.append(f"{code}: same sample point as {seen[key]}")
        seen[key] = code
        rings = _outer_rings(regions[code])
        if not any(inside((point.latitude, point.longitude), ring) for ring in rings):
            problems.append(f"{code}: sample point is outside its own boundary")
    return problems


def check_snapshot_urls(
    reference: dict[str, SamplePoint], manifest: Manifest, expected: set[str]
) -> list[str]:
    """The sealed response for a region must have been requested at that region's reviewed point.

    Without this the published value could come from a different coordinate than the one the file
    records, which is exactly the silent mismatch the reference file exists to prevent.
    """
    by_name = {file.name: file for file in manifest.files}
    problems: list[str] = []
    for code in sorted(expected):
        file = by_name.get(FILE_TEMPLATE.format(code=code))
        if file is None:
            continue  # reported by build_records as a missing response
        point = reference.get(code)
        if point is None:
            continue
        if file.url != identify_url(point.latitude, point.longitude):
            problems.append(f"{code}: snapshot response was fetched at a different sample point")
    return problems


def build_records(
    reference: dict[str, SamplePoint], contents: dict[str, bytes], expected: set[str]
) -> tuple[dict[str, dict[str, object]], dict[str, str], list[str]]:
    """One record per region, the reasons some cells hold no data, and every hard failure.

    A region whose sample point lands on a `NoData` cell of the source raster is published as
    unavailable (the web file omits the region) instead of being dropped silently: BMKG's product
    does not cover every small island, and inventing a value for it is not an option.
    """
    problems: list[str] = []
    records: dict[str, dict[str, object]] = {}
    unavailable: dict[str, str] = {}
    for code in sorted(expected):
        content = contents.get(FILE_TEMPLATE.format(code=code))
        if content is None:
            problems.append(f"{code}: no identify response in the snapshot")
            continue
        try:
            layers = parse_identify(content)
        except (ValueError, json.JSONDecodeError) as error:
            problems.append(f"{code}: unreadable identify response ({error})")
            continue
        monthly = [layers.get(layer) for layer in MONTH_LAYERS]
        present = [value for value in monthly if value is not None]
        missing = [MONTH_NAMES[index] for index, value in enumerate(monthly) if value is None]
        if len(monthly) != MONTHS or missing or len(present) != MONTHS:
            if missing and len(missing) == MONTHS:
                unavailable[code] = "titik sampel berada di luar cakupan raster BMKG (NoData seluruh bulan)"
                continue
            problems.append(f"{code}: no normal-rainfall value for {missing}")
            continue
        values = [float(value) for value in present]
        if any(not math.isfinite(value) for value in values):
            problems.append(f"{code}: non-finite monthly value")
            continue
        if any(value < 0 for value in values):
            # BMKG's raster reports physically impossible negative normals over two Sumbawa cells
            # (52.04 Kabupaten Sumbawa: Agustus; 52.05 Kabupaten Dompu: Agustus and September, in the
            # 17 October 2026 snapshot). Negative rainfall is impossible, so no month is invented and
            # no partial total is published: the region shows unavailable with the reason, reported
            # for upstream follow-up.
            negative = [MONTH_NAMES[index] for index, value in enumerate(present) if value < 0]
            unavailable[code] = (
                "nilai normal BMKG untuk " + ", ".join(negative) + " bernilai negatif (artefak raster), "
                "sehingga tidak diterbitkan"
            )
            continue
        point = reference[code]
        # Months are published rounded to 0.1 mm, and the total is the sum of the PUBLISHED months,
        # not of full-precision values: otherwise the table's own column would not add up to the
        # total printed beneath it (the difference reaches 0.3 mm, and a reader who adds the column
        # would be right and the published total wrong). The unit is millimetres; a 0.1 mm step is
        # below anything the source itself resolves.
        monthly_mm = {
            MONTH_NAMES[index]: round(float(value), 1) for index, value in enumerate(present)
        }
        records[code] = {
            "sample_point": {
                "latitude": point.latitude,
                "longitude": point.longitude,
                "method": point.method,
                "note": point.note,
            },
            # Keyed by month name rather than a bare array: the value says which month it is, and the
            # object stays expanded under the repository formatter (see
            # packages/contracts/src/weather.ts for why that matters).
            "monthly_mm": monthly_mm,
            "annual_mm": round(sum(monthly_mm.values()), 1),
        }
    return records, unavailable, problems
