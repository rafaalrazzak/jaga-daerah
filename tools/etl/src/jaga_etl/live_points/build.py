"""Join the region reference, the wilayah code list, reviewed sample points and boundaries by code.

Every join is by Kemendagri code, never by name. Region names from `regions.json` must equal the
names in the wilayah dump for the same code; a disagreement blocks the build.

Reference point rule (adm4): the forecast point of a region is the lowest-coded kelurahan/desa inside
its lowest-coded kecamatan (normally `XX.YY.01.1001`, but the lowest code that actually exists wins).
It is deterministic and only names WHERE the BMKG forecast is read; the UI labels it by desa and
kecamatan name and must not present it as the regency capital or as an areal average.

`kecamatan_list` lists every kecamatan of the region, sorted by name, each with its own forecast
point by the same rule (lowest-coded kelurahan/desa inside that kecamatan), so a reader can pick one.
The region default is the entry for the lowest-coded kecamatan.

`bbox` is `[west, south, east, north]` over every ring of the region's boundary, rounded outward to
three decimals (floor for west/south, ceil for east/north) so it always contains the outline. It is
used to filter NASA FIRMS hotspots; a hotspot inside the box is not necessarily inside the region.
"""

import math
import re
from dataclasses import dataclass
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal

from jaga_etl.boundaries.build import Boundary
from jaga_etl.regions.normalize import VALUE_TUPLE, normalize_name
from jaga_etl.weather.build import SamplePoint

REGION_CODE = re.compile(r"\d{2}\.\d{2}")
KECAMATAN_CODE = re.compile(r"\d{2}\.\d{2}\.\d{2}")
ADM4_CODE = re.compile(r"\d{2}\.\d{2}\.\d{2}\.\d{4}")
# Generous envelope around Indonesia; anything outside it is a coordinate-order or parsing error.
LON_RANGE = (94.0, 142.0)
LAT_RANGE = (-12.0, 7.0)
POINT_DECIMALS = 4
BBOX_DECIMALS = 3


class QualityGateError(Exception):
    """Raised with every problem found, so one run reports all of them instead of the first."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__(
            f"Live-points quality gate failed ({len(problems)} problem(s)): " + "; ".join(problems[:5])
        )


@dataclass(frozen=True)
class Subdivisions:
    names: dict[str, str]  # region code → name
    kecamatan: dict[str, dict[str, str]]  # region code → {kecamatan code → name}
    adm4: dict[str, dict[str, str]]  # kecamatan code → {adm4 code → name}
    duplicates: list[str]  # codes that appear more than once in the dump


def parse_subdivisions(dump: str) -> Subdivisions:
    """Read region, kecamatan and kelurahan/desa tuples from the (never executed) wilayah dump."""
    names: dict[str, str] = {}
    kecamatan: dict[str, dict[str, str]] = {}
    adm4: dict[str, dict[str, str]] = {}
    seen: set[str] = set()
    duplicates: list[str] = []
    for match in VALUE_TUPLE.finditer(dump):
        code = match.group("code")
        name = normalize_name(match.group("name"))
        if code in seen:
            duplicates.append(code)
        seen.add(code)
        if REGION_CODE.fullmatch(code):
            names[code] = name
        elif KECAMATAN_CODE.fullmatch(code):
            kecamatan.setdefault(code[:5], {})[code] = name
        elif ADM4_CODE.fullmatch(code):
            adm4.setdefault(code[:8], {})[code] = name
    return Subdivisions(names=names, kecamatan=kecamatan, adm4=adm4, duplicates=duplicates)


def _code_key(code: str) -> tuple[int, ...]:
    # Numeric order per segment, so a lowest code is the same whatever the zero padding.
    return tuple(int(part) for part in code.split("."))


def lowest_adm4(subdivisions: Subdivisions, kecamatan_code: str) -> tuple[str, str] | None:
    """`(adm4 code, desa name)` of the lowest-coded kelurahan/desa in a kecamatan, or None."""
    villages = subdivisions.adm4.get(kecamatan_code)
    if not villages:
        return None
    adm4_code = min(villages, key=_code_key)
    return adm4_code, villages[adm4_code]


def reference_adm4(subdivisions: Subdivisions, region_code: str) -> tuple[str, str, str, str] | None:
    """`(adm4 code, desa name, kecamatan code, kecamatan name)` by the lowest-code rule, or None."""
    kecamatan = subdivisions.kecamatan.get(region_code)
    if not kecamatan:
        return None
    kecamatan_code = min(kecamatan, key=_code_key)
    village = lowest_adm4(subdivisions, kecamatan_code)
    if village is None:
        return None
    return village[0], village[1], kecamatan_code, kecamatan[kecamatan_code]


def kecamatan_entries(subdivisions: Subdivisions, region_code: str) -> tuple[list[dict[str, str]], list[str]]:
    """Every kecamatan of a region with its own forecast point, sorted by name, plus gate problems."""
    entries: list[dict[str, str]] = []
    problems: list[str] = []
    for code, name in subdivisions.kecamatan.get(region_code, {}).items():
        village = lowest_adm4(subdivisions, code)
        if village is None:
            problems.append(f"{region_code}: kecamatan {code} has no kelurahan/desa in wilayah")
            continue
        adm4_code, desa = village
        if not ADM4_CODE.fullmatch(adm4_code) or not adm4_code.startswith(code + "."):
            problems.append(f"{region_code}: adm4 {adm4_code!r} does not belong to kecamatan {code}")
        entries.append({"code": code, "name": name, "adm4": adm4_code, "desa": desa})
    entries.sort(key=lambda entry: (entry["name"], _code_key(entry["code"])))
    return entries, problems


def _round_outward(value: float, rounding: str) -> float:
    # Decimal over the shortest repr, so -6.7 floors to -6.7 rather than -6.701 from binary error.
    step = Decimal(1).scaleb(-BBOX_DECIMALS)
    return float(Decimal(repr(value)).quantize(step, rounding=rounding))


def outward_bbox(boundary: Boundary) -> list[float]:
    """`[west, south, east, north]` over every ring, rounded outward to `BBOX_DECIMALS`."""
    lats = [lat for polygon in boundary.polygons for ring in polygon for lat, _ in ring]
    lons = [lon for polygon in boundary.polygons for ring in polygon for _, lon in ring]
    return [
        _round_outward(min(lons), ROUND_FLOOR),
        _round_outward(min(lats), ROUND_FLOOR),
        _round_outward(max(lons), ROUND_CEILING),
        _round_outward(max(lats), ROUND_CEILING),
    ]


def _bbox_problems(code: str, bbox: list[float], boundary: Boundary, lat: float, lon: float) -> list[str]:
    west, south, east, north = bbox
    problems = []
    if not (west < east and south < north):
        problems.append(f"{code}: degenerate bbox {bbox}")
    if not (LON_RANGE[0] <= west and east <= LON_RANGE[1] and LAT_RANGE[0] <= south and north <= LAT_RANGE[1]):
        problems.append(f"{code}: bbox {bbox} is outside Indonesia")
    if not (west <= lon <= east and south <= lat <= north):
        problems.append(f"{code}: sample point ({lat}, {lon}) is outside its bbox {bbox}")
    points = [point for polygon in boundary.polygons for ring in polygon for point in ring]
    if any(not (west <= p_lon <= east and south <= p_lat <= north) for p_lat, p_lon in points):
        problems.append(f"{code}: bbox {bbox} does not contain the whole outline")
    return problems


def build_regions(
    reference: list[dict[str, object]],
    subdivisions: Subdivisions,
    points: dict[str, SamplePoint],
    boundaries: dict[str, Boundary],
) -> dict[str, dict[str, object]]:
    """One record per `regions.json` entry, keyed by slug; raises with every gate problem found."""
    problems: list[str] = []
    expected = {str(item["code"]) for item in reference}
    for label, codes in (
        ("wilayah", set(subdivisions.names)),
        ("sample points", set(points)),
        ("boundaries", set(boundaries)),
    ):
        if codes != expected:
            problems.append(
                f"{label} do not match regions.json: missing={sorted(expected - codes)[:8]} "
                f"extra={sorted(codes - expected)[:8]}"
            )
    if subdivisions.duplicates:
        problems.append(f"wilayah has duplicate codes: {sorted(set(subdivisions.duplicates))[:8]}")
    if len({item["slug"] for item in reference}) != len(reference):
        problems.append("regions.json has duplicate slugs")

    records: dict[str, dict[str, object]] = {}
    for item in sorted(reference, key=lambda entry: str(entry["slug"])):
        code, slug, name = str(item["code"]), str(item["slug"]), str(item["name"])
        province = item["province"]
        if not isinstance(province, dict):
            problems.append(f"{code}: regions.json province is not an object")
            continue
        if code not in subdivisions.names or code not in points or code not in boundaries:
            continue  # already reported as a coverage gap above
        if subdivisions.names[code] != name:
            problems.append(f"{code}: regions.json name {name!r} != wilayah {subdivisions.names[code]!r}")

        chosen = reference_adm4(subdivisions, code)
        if chosen is None:
            problems.append(f"{code}: no kecamatan with a kelurahan/desa in wilayah")
            continue
        adm4_code, desa, kecamatan_code, kecamatan = chosen
        if not ADM4_CODE.fullmatch(adm4_code) or not adm4_code.startswith(code + "."):
            problems.append(f"{code}: adm4 {adm4_code!r} does not belong to the region")
        entries, entry_problems = kecamatan_entries(subdivisions, code)
        problems += entry_problems
        listed = [entry for entry in entries if entry["code"] == kecamatan_code]
        if len(listed) != 1:
            problems.append(f"{code}: default kecamatan {kecamatan_code} is not listed exactly once")
        elif listed[0]["adm4"] != adm4_code:
            problems.append(f"{code}: default adm4 {adm4_code} != kecamatan_list adm4 {listed[0]['adm4']}")
        if len({entry["code"] for entry in entries}) != len(entries):
            problems.append(f"{code}: duplicate kecamatan codes in kecamatan_list")

        point = points[code]
        if not (math.isfinite(point.latitude) and math.isfinite(point.longitude)):
            problems.append(f"{code}: sample point is not finite")
            continue
        lat = round(point.latitude, POINT_DECIMALS)
        lon = round(point.longitude, POINT_DECIMALS)
        bbox = outward_bbox(boundaries[code])
        problems += _bbox_problems(code, bbox, boundaries[code], lat, lon)

        records[slug] = {
            "code": code,
            "name": name,
            "province_code": str(province["code"]),
            "province_name": str(province["name"]),
            "adm4": adm4_code,
            "desa": desa,
            "kecamatan": kecamatan,
            "lat": lat,
            "lon": lon,
            "bbox": bbox,
            "kecamatan_list": entries,
        }
    if problems:
        raise QualityGateError(problems)
    return records
