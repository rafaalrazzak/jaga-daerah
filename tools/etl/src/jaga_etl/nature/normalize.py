"""Parse the pinned BIG and BNPB payloads into per-kabupaten/kota natural-condition facts.

Everything here is a fact the source itself states. Nothing is re-derived, re-weighted,
interpolated or scored: the module copies numbers out and normalises their spelling.

Two deliberate corrections/tolerances, both recorded rather than silent:

- **BIG area unit.** The `LUASWH` field's alias says "Luas Wilayah Menurut Peraturan (HA)", but the
  published values are square kilometres. Summing the kabupaten/kota rows per province reproduces
  the official provincial areas in km² (Aceh 56,835 vs 57,956; DI Yogyakarta 3,170.36 vs 3,170.6;
  DKI Jakarta 661.53 vs 664.01; East Java 48,055.87 vs 48,036; Kota Bandung 166.59 vs 167.67),
  whereas hectares would be about a hundred times larger. The alias is wrong; the unit published is
  km².
- **BIG editions.** Six region codes appear twice: once in the current edition and once as a tiny
  stale sliver from an older edition. Parsing deliberately refuses to choose: a code published more
  than once is reported as ambiguous with every candidate row, and the choice must come from
  `reference/nature-big-editions.csv` (reviewed) or the build fails. A duplicate *within* one
  edition is likewise surfaced rather than silently picked.
"""

import json
from dataclasses import dataclass, field

from jaga_etl.nature.mapping import EditionChoice
from jaga_etl.nature.source import (
    BIG_KABUPATEN_TIPADM,
    BIG_KOTA_TIPADM,
    BNPB_CODE_COLUMN,
    BNPB_FIRST_YEAR,
    BNPB_HAZARD_COLUMNS,
    BNPB_LAST_YEAR,
    BNPB_NAME_COLUMN,
    BNPB_NATIONAL_NAME,
    BNPB_YEAR_COLUMN,
)

AREA_UNIT = "km²"


class NatureParseError(Exception):
    pass


@dataclass(frozen=True)
class AreaRecord:
    """Statutory area as BIG publishes it, with the geodatabase edition it came from."""

    region_code: str
    name: str
    area_km2: float
    edition: str


@dataclass(frozen=True)
class EventRecord:
    """One recorded disaster-event count for a region, from one of the two sources."""

    region_code: str
    year: int
    hazard: str | None  # None = the year's total across all hazards
    event_count: int
    name: str


@dataclass(frozen=True)
class ImpactRecord:
    """One recorded impact figure for a region: a metric, optionally for one hazard, in 2024."""

    region_code: str
    metric: str
    hazard: str | None  # None = the total across all hazards
    value: int
    name: str


@dataclass(frozen=True)
class Normalized:
    areas: dict[str, AreaRecord] = field(default_factory=dict)
    # (region_code, year) → total recorded events across all hazards.
    events_by_year: dict[tuple[str, int], EventRecord] = field(default_factory=dict)
    # (region_code, hazard) → recorded events of that hazard in 2024.
    events_by_hazard: dict[tuple[str, str], EventRecord] = field(default_factory=dict)
    # (region_code, metric) → recorded impact of that metric in 2024, across all hazards.
    impacts_by_metric: dict[tuple[str, str], ImpactRecord] = field(default_factory=dict)
    # (region_code, hazard, metric) → recorded impact of that metric for that hazard in 2024.
    impacts_by_hazard: dict[tuple[str, str, str], ImpactRecord] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)


def region_code(value: object) -> str:
    """Kemendagri code with the dot, from either source's spelling ("1101.0", 1101 → "11.01")."""
    if value is None or isinstance(value, bool):
        raise ValueError(f"invalid region code {value!r}")
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    digits = "".join(character for character in text if character.isdigit())
    if len(digits) != 4:
        raise ValueError(f"invalid region code {value!r}")
    return f"{digits[:2]}.{digits[2:]}"


def count(value: object) -> int | None:
    """An event count as published. `None` stays `None`: the source does not state it."""
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"invalid count {value!r}")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = str(value).strip()
    if text == "":
        return None
    # Published cells are plain integers, occasionally spelled "0.0".
    if text.endswith(".0"):
        text = text[:-2]
    return int(text)


def parse_big(
    payload: bytes, editions: dict[str, EditionChoice]
) -> tuple[dict[str, AreaRecord], list[str]]:
    """Attribute rows → one area per kabupaten/kota.

    A code published by more than one geodatabase edition is ambiguous. It is resolved only by a
    reviewed row in `reference/nature-big-editions.csv`; without one the code is reported as a
    problem and the build stops, because picking a row by rule would silently choose between two
    different areas for the same region.
    """
    document = json.loads(payload)
    if "error" in document:
        raise NatureParseError(f"BIG query failed: {document['error']}")
    features = document.get("features")
    if not isinstance(features, list):
        raise NatureParseError("BIG response has no feature list")

    by_code: dict[str, list[dict[str, object]]] = {}
    for feature in features:
        attributes = feature.get("attributes", {})
        tipadm = attributes.get("TIPADM")
        if tipadm not in (BIG_KABUPATEN_TIPADM, BIG_KOTA_TIPADM):
            continue  # provinces and any other administrative level are out of scope
        code = region_code(attributes.get("KDPKAB"))
        by_code.setdefault(code, []).append(attributes)

    areas: dict[str, AreaRecord] = {}
    problems: list[str] = []
    for code, rows in by_code.items():
        chosen: dict[str, object] | None = None
        if len(rows) > 1:
            reviewed = editions.get(code)
            if reviewed is None:
                editions_seen = sorted({str(row.get("METADATA") or "") for row in rows})
                problems.append(
                    f"BIG publishes {len(rows)} rows for {code} (editions {editions_seen}) "
                    "and no reviewed row chooses one"
                )
                continue
            matching = [row for row in rows if str(row.get("METADATA") or "") == reviewed.edition]
            if len(matching) != 1:
                problems.append(
                    f"reviewed edition {reviewed.edition} for {code} matches {len(matching)} rows"
                )
                continue
            chosen = matching[0]
        else:
            chosen = rows[0]

        value = chosen.get("LUASWH")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            problems.append(f"BIG area for {code} is not a positive number: {value!r}")
            continue
        areas[code] = AreaRecord(
            region_code=code,
            name=str(chosen.get("WADMKK") or "").strip(),
            area_km2=float(value),
            edition=str(chosen.get("METADATA") or ""),
        )
    return areas, problems


def parse_bnpb_years(payload: bytes) -> tuple[dict[tuple[str, int], EventRecord], list[str]]:
    """The 2010-2024 per-kabupaten table: one total event count per region and year."""
    records = _datastore_records(payload)
    events: dict[tuple[str, int], EventRecord] = {}
    problems: list[str] = []
    for row in records:
        try:
            code = region_code(row.get(BNPB_CODE_COLUMN))
        except ValueError:
            name = str(row.get(BNPB_NAME_COLUMN) or "").strip().upper()
            if name and name != BNPB_NATIONAL_NAME:
                problems.append(f"BNPB row without a usable region code: {name!r}")
            continue
        name = str(row.get(BNPB_NAME_COLUMN) or "").strip()
        for year in range(BNPB_FIRST_YEAR, BNPB_LAST_YEAR + 1):
            value = count(row.get(BNPB_YEAR_COLUMN.format(year=year)))
            if value is None:
                continue  # the source does not state this year; "not stated" is not zero
            if value < 0:
                problems.append(f"BNPB events for {code} {year} is negative: {value}")
                continue
            events[(code, year)] = EventRecord(code, year, None, value, name)
    return events, problems


def parse_bnpb_hazards(payload: bytes) -> tuple[dict[tuple[str, str], EventRecord], list[str]]:
    """The 2024 per-kabupaten table: one event count per region and hazard type."""
    records = _datastore_records(payload)
    events: dict[tuple[str, str], EventRecord] = {}
    problems: list[str] = []
    for row in records:
        try:
            code = region_code(row.get(BNPB_CODE_COLUMN))
        except ValueError:
            name = str(row.get(BNPB_NAME_COLUMN) or "").strip().upper()
            # The national total is a published row, not a region: skipped, never a problem.
            if name and name != BNPB_NATIONAL_NAME:
                problems.append(f"BNPB row without a usable region code: {name!r}")
            continue
        name = str(row.get(BNPB_NAME_COLUMN) or "").strip()
        for column, hazard in BNPB_HAZARD_COLUMNS.items():
            value = count(row.get(column))
            if value is None:
                continue
            if value < 0:
                problems.append(f"BNPB {hazard} events for {code} is negative: {value}")
                continue
            events[(code, hazard)] = EventRecord(code, BNPB_LAST_YEAR, hazard, value, name)
    return events, problems


def parse_bnpb_impacts(
    payloads: dict[str, bytes],
) -> tuple[dict[tuple[str, str], ImpactRecord], dict[tuple[str, str, str], ImpactRecord], list[str]]:
    """The 2024 impact tables: one published figure per region, metric and hazard.

    Each resource holds the same nine hazard columns for one metric (deaths, missing, affected…),
    so the total for a metric is the sum of those columns only when the source states all nine.
    A cell left blank is not zero: the region keeps no total for that metric rather than a partial
    one, and the metric's per-hazard values are still published for the hazards it does state.
    """
    by_metric: dict[tuple[str, str], ImpactRecord] = {}
    by_hazard: dict[tuple[str, str, str], ImpactRecord] = {}
    problems: list[str] = []
    for metric, payload in payloads.items():
        records = _datastore_records(payload)
        for row in records:
            try:
                code = region_code(row.get(BNPB_CODE_COLUMN))
            except ValueError:
                name = str(row.get(BNPB_NAME_COLUMN) or "").strip().upper()
                if name and name != BNPB_NATIONAL_NAME:
                    problems.append(f"BNPB impact row without a usable region code: {name!r}")
                continue
            name = str(row.get(BNPB_NAME_COLUMN) or "").strip()
            stated: dict[str, int] = {}
            for column, hazard in BNPB_HAZARD_COLUMNS.items():
                value = count(row.get(column))
                if value is None:
                    continue
                if value < 0:
                    problems.append(f"BNPB impact {metric}/{hazard} for {code} is negative: {value}")
                    continue
                stated[hazard] = value
                by_hazard[(code, hazard, metric)] = ImpactRecord(
                    code, metric, hazard, value, name
                )
            if len(stated) == len(BNPB_HAZARD_COLUMNS):
                by_metric[(code, metric)] = ImpactRecord(
                    code, metric, None, sum(stated.values()), name
                )
    return by_metric, by_hazard, problems


def _datastore_records(payload: bytes) -> list[dict[str, object]]:
    document = json.loads(payload)
    if not document.get("success"):
        raise NatureParseError("BNPB datastore response reports failure")
    result = document.get("result") or {}
    records = result.get("records")
    if not isinstance(records, list):
        raise NatureParseError("BNPB datastore response has no record list")
    total = result.get("total")
    if isinstance(total, int) and total > len(records):
        raise NatureParseError(f"BNPB page holds {len(records)} of {total} rows; increase the page limit")
    return records


def normalize(
    big_payload: bytes,
    bnpb_years_payload: bytes,
    bnpb_hazards_payload: bytes,
    *,
    editions: dict[str, EditionChoice],
    bnpb_impact_payloads: dict[str, bytes] | None = None,
) -> Normalized:
    areas, problems = parse_big(big_payload, editions)
    events_by_year, year_problems = parse_bnpb_years(bnpb_years_payload)
    events_by_hazard, hazard_problems = parse_bnpb_hazards(bnpb_hazards_payload)
    impacts_by_metric, impacts_by_hazard, impact_problems = parse_bnpb_impacts(
        bnpb_impact_payloads or {}
    )
    problems = [*problems, *year_problems, *hazard_problems, *impact_problems]
    return Normalized(
        areas=areas,
        events_by_year=events_by_year,
        events_by_hazard=events_by_hazard,
        impacts_by_metric=impacts_by_metric,
        impacts_by_hazard=impacts_by_hazard,
        problems=problems,
    )
