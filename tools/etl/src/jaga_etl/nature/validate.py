"""Blocking quality gate for the natural-conditions artifact.

The gate compares what the sources publish against the region list the rest of the product uses.
It fails the build on anything that would make a published figure wrong or unattributable:

- a region the sources cover but the region list does not know (an unexpected extra region);
- a source row whose region cannot be mapped to a Kemendagri code at all;
- a region listed twice for the same year and hazard;
- an area that is not a positive number, or a negative event count.

Coverage, by contrast, is **reported, never required to be complete**. Neither source publishes all
514 kabupaten/kota: the disaster-event tables omit regions entirely, and an omitted region means
the source does not state a value for it — not that the value is zero. The gate therefore records
the exact covered count per sub-topic so the artifact can state its real coverage and the page
never implies national coverage it does not have.
"""

from dataclasses import dataclass, field

from jaga_etl.nature.normalize import Normalized
from jaga_etl.nature.source import BNPB_HAZARD_COLUMNS


@dataclass
class GateResult:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    coverage: dict[str, object] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return not self.errors


def check(normalized: Normalized, known_codes: set[str], total_regions: int) -> GateResult:
    gate = GateResult()
    gate.errors.extend(normalized.problems)

    expected_hazards = set(BNPB_HAZARD_COLUMNS.values())
    area_codes = set(normalized.areas)
    year_codes = {code for code, _ in normalized.events_by_year}
    hazard_codes = {code for code, _ in normalized.events_by_hazard}
    impact_codes = {code for code, _ in normalized.impacts_by_metric}

    # An extra region means the mapping produced a code the product cannot resolve: publishing it
    # would create a region page that nothing links to and nothing else agrees exists.
    for label, codes in (
        ("BIG area", area_codes),
        ("BNPB events by year", year_codes),
        ("BNPB events by hazard", hazard_codes),
        ("BNPB impact 2024", impact_codes),
    ):
        extra = sorted(codes - known_codes)
        if extra:
            gate.errors.append(f"{label}: {len(extra)} region(s) not in the region list: {extra[:10]}")

    # No region may carry two figures for the same metric, and none for the same metric and hazard:
    # a repeat means the parse would silently overwrite a published value.
    seen_metric: dict[tuple[str, str], int] = {}
    for record in normalized.impacts_by_metric.values():
        key = (record.region_code, record.metric)
        seen_metric[key] = seen_metric.get(key, 0) + 1
    seen_impact: dict[tuple[str, str, str], int] = {}
    for record in normalized.impacts_by_hazard.values():
        key = (record.region_code, record.hazard or "", record.metric)
        seen_impact[key] = seen_impact.get(key, 0) + 1
    repeated_metric = sorted(key for key, occurrence in seen_metric.items() if occurrence > 1)
    repeated_impact = sorted(key for key, occurrence in seen_impact.items() if occurrence > 1)
    if repeated_metric:
        gate.errors.append(f"BNPB repeated region/metric impact rows: {repeated_metric[:10]}")
    if repeated_impact:
        gate.errors.append(f"BNPB repeated region/hazard/metric impact rows: {repeated_impact[:10]}")

    unknown_hazards = sorted({record.hazard for record in normalized.events_by_hazard.values()} - expected_hazards)
    if unknown_hazards:
        gate.errors.append(f"BNPB hazard keys outside the published classification: {unknown_hazards}")

    gate.coverage = {
        "total_regions": total_regions,
        "area": _coverage(area_codes, known_codes, "Luas wilayah menurut peraturan (BIG)"),
        "events_by_year": _coverage(year_codes, known_codes, "Kejadian bencana per tahun (BNPB)"),
        "events_by_hazard_2024": _coverage(hazard_codes, known_codes, "Kejadian bencana per jenis, 2024 (BNPB)"),
        "impacts_2024": _coverage(impact_codes, known_codes, "Dampak bencana per jenis, 2024 (BNPB)"),
    }
    missing_area = sorted(known_codes - area_codes)
    missing_events = sorted(known_codes - hazard_codes)
    if missing_area:
        gate.warnings.append(
            f"BIG publishes no area for {len(missing_area)} region(s): {missing_area[:10]}"
        )
    if missing_events:
        gate.warnings.append(
            f"BNPB's 2024 hazard table omits {len(missing_events)} region(s): {missing_events[:10]}"
        )
    return gate


def _coverage(codes: set[str], known_codes: set[str], label: str) -> dict[str, object]:
    covered = sorted(codes & known_codes)
    # `missing` is an object keyed by region code rather than an array: the formatter collapses
    # short string arrays onto one line, which would make this generated file fail
    # `bun run format:check`, while an object of code → reason stays expanded.
    missing = {code: "tidak ada di sumber" for code in sorted(known_codes - codes)}
    return {
        "label": label,
        "covered": len(covered),
        "total": len(known_codes),
        "missing": missing,
    }
