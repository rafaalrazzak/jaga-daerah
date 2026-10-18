"""Quality gate for a budget + natural-resource revenue + disaster publication (PRD §9.2). Pure: no I/O, no database.

Blocking errors stop publication; warnings are recorded in the report for human review.
"""

import csv
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

from jaga_etl.facts.bnpb.normalize import BnpbResult, DisasterRecord
from jaga_etl.facts.bnpb.source import DISASTER_COLUMNS
from jaga_etl.facts.djpk.mapping import KemendagriRegion, RegionMatcher
from jaga_etl.facts.djpk.normalize import DjpkResult

# DKI Jakarta's kabupaten/kota are administrative, without their own APBD.
NON_AUTONOMOUS_PROVINCES = frozenset({"31"})
MIN_BUDGET_COVERAGE = Decimal("0.90")
MAX_ROW_DELTA = Decimal("0.10")
EXPECTED_DISASTER_TYPES = frozenset(DISASTER_COLUMNS.values())
# DJPK prints each Belanja Daerah figure rounded, so the ten jenis subtotals can miss the published
# total by the accumulated rounding of eleven printed values: under Rp1 for the overwhelming
# majority of pemda, and under Rp0.51 across every file in the sealed 2024/2025 snapshot. Rp1.00
# absorbs that rounding with margin while still catching a wrong or missing jenis (the smallest
# published jenis in the snapshot is Rp1,093,400).
EXPENDITURE_TOLERANCE = Decimal("1.00")


@dataclass(frozen=True)
class BudgetFact:
    region_code: str
    year: int
    budget_amount: Decimal | None
    realization_amount: Decimal | None
    reduced_precision: bool
    match_method: str


@dataclass(frozen=True)
class ResourceFact:
    region_code: str
    year: int
    resource_type: str
    budget_amount: Decimal | None
    realization_amount: Decimal | None


@dataclass(frozen=True)
class ExpenditureFact:
    region_code: str
    year: int
    expenditure_type: str
    budget_amount: Decimal | None
    realization_amount: Decimal | None


@dataclass(frozen=True)
class AcceptedDiscrepancy:
    """A reviewed, exact mismatch between BNPB province rows and its own national total."""

    year: int
    metric: str
    disaster_type: str
    province_sum: int
    national_total: int


@dataclass(frozen=True)
class PreviousVersion:
    version: str
    budget_rows: int
    expenditure_rows: int
    disaster_rows: int


@dataclass
class GateResult:
    budget_facts: list[BudgetFact] = field(default_factory=list)
    resource_facts: list[ResourceFact] = field(default_factory=list)
    expenditure_facts: list[ExpenditureFact] = field(default_factory=list)
    disaster_facts: list[DisasterRecord] = field(default_factory=list)
    accepted_discrepancies: list[AcceptedDiscrepancy] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    report: dict[str, object] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return not self.errors


def _map_budget(djpk: DjpkResult, matcher: RegionMatcher, gate: GateResult) -> list[dict[str, str]]:
    alias_matches: list[dict[str, str]] = []
    unmatched: list[str] = []
    for record in djpk.records:
        province = matcher.province(record.djpk_province_code, record.djpk_province_name)
        region = (
            matcher.region(record.djpk_province_code, province, record.djpk_pemda_name)
            if province is not None
            else None
        )
        if region is None:
            unmatched.append(
                f"{record.year} {record.djpk_province_code}-{record.djpk_pemda_code} "
                f"{record.djpk_province_name} / {record.djpk_pemda_name}"
            )
            continue
        if region.method == "alias":
            alias_matches.append({"djpk": record.djpk_pemda_name, "kemendagri_code": region.kemendagri_code})
        gate.budget_facts.append(
            BudgetFact(
                region_code=region.kemendagri_code,
                year=record.year,
                budget_amount=record.budget_amount,
                realization_amount=record.realization_amount,
                reduced_precision=record.reduced_precision,
                match_method=region.method,
            )
        )
    gate.errors.extend(f"unmatched DJPK pemda: {item}" for item in sorted(set(unmatched)))
    return alias_matches


def _map_resources(djpk: DjpkResult, matcher: RegionMatcher, gate: GateResult) -> None:
    """Same DJPK → Kemendagri mapping as the budget rows; an unmatched pemda already blocks there."""
    for record in djpk.resources:
        province = matcher.province(record.djpk_province_code, record.djpk_province_name)
        region = (
            matcher.region(record.djpk_province_code, province, record.djpk_pemda_name)
            if province is not None
            else None
        )
        if region is None:
            continue
        gate.resource_facts.append(
            ResourceFact(
                region_code=region.kemendagri_code,
                year=record.year,
                resource_type=record.resource_type,
                budget_amount=record.budget_amount,
                realization_amount=record.realization_amount,
            )
        )


def _map_expenditures(djpk: DjpkResult, matcher: RegionMatcher, gate: GateResult) -> None:
    """Same DJPK → Kemendagri mapping as the budget rows; an unmatched pemda already blocks there."""
    for record in djpk.expenditures:
        province = matcher.province(record.djpk_province_code, record.djpk_province_name)
        region = (
            matcher.region(record.djpk_province_code, province, record.djpk_pemda_name)
            if province is not None
            else None
        )
        if region is None:
            continue
        gate.expenditure_facts.append(
            ExpenditureFact(
                region_code=region.kemendagri_code,
                year=record.year,
                expenditure_type=record.expenditure_type,
                budget_amount=record.budget_amount,
                realization_amount=record.realization_amount,
            )
        )


def collect_djpk_facts(
    djpk: DjpkResult, matcher: RegionMatcher
) -> tuple[GateResult, list[dict[str, str]]]:
    """Map DJPK records to facts without a database.

    `run_gate` calls this and then adds BNPB and the publication checks; the web artifact build calls
    it directly, because it needs the same region mapping and the same expenditure facts but neither
    the disaster data nor the version-comparison checks. Sharing the call keeps the static page and
    the API reading identical facts from identical bytes. The alias list is returned so the caller
    can report which pemda matched through `reference/djpk-aliases.csv`.
    """
    gate = GateResult()
    gate.errors.extend(f"DJPK rejection: {item}" for item in djpk.rejections)
    alias_matches = _map_budget(djpk, matcher, gate)
    _map_resources(djpk, matcher, gate)
    _map_expenditures(djpk, matcher, gate)
    return gate, alias_matches


def reconcile_expenditure_subtotals(
    expenditure_facts: list[ExpenditureFact],
    budget_facts: list[BudgetFact],
    tolerance: Decimal = EXPENDITURE_TOLERANCE,
) -> tuple[Decimal, int, list[str]]:
    """Compare each region-year's jenis subtotals against its published Belanja Daerah total.

    Returns (worst absolute difference, region-years compared, blocking messages). Kept separate
    from the gate so the database publication and the web artifact share one implementation: two
    copies of the tolerance could disagree, and then the static page and the API would publish
    different things from the same bytes.

    A region-year is skipped when the total or any subtotal is NULL — an incomplete partition is
    reported as partial, never compared as if it were whole.
    """
    totals = {(f.region_code, f.year): f for f in budget_facts}
    by_region_year: dict[tuple[str, int], list[ExpenditureFact]] = defaultdict(list)
    for fact in expenditure_facts:
        by_region_year[(fact.region_code, fact.year)].append(fact)

    worst = Decimal(0)
    compared = 0
    problems: list[str] = []
    for key, facts in sorted(by_region_year.items()):
        budget_fact = totals.get(key)
        if budget_fact is None:
            continue
        compared += 1
        for field_name, total, field in (
            ("anggaran", budget_fact.budget_amount, "budget_amount"),
            ("realisasi", budget_fact.realization_amount, "realization_amount"),
        ):
            parts = [getattr(fact, field) for fact in facts]
            if total is None or any(part is None for part in parts):
                continue
            subtotal = sum(parts, Decimal(0))
            difference = abs(subtotal - total)
            worst = max(worst, difference)
            if difference > tolerance:
                problems.append(
                    f"jenis belanja {field_name} for {key[0]} {key[1]} sum to {subtotal}, "
                    f"published total is {total} (off by {difference})"
                )
    return worst, compared, problems


def _check_expenditures(gate: GateResult, years: tuple[int, ...]) -> dict[str, object]:
    """The jenis subtotals must sum to the published Belanja Daerah total; that is the check that
    makes the breakdown trustworthy, so a gap larger than the source's own rounding tolerance
    blocks publication. The comparison itself lives in `reconcile_expenditure_subtotals` so the
    web artifact is gated by exactly the same rule.
    """
    keys = Counter((f.region_code, f.year, f.expenditure_type) for f in gate.expenditure_facts)
    gate.errors.extend(
        f"duplicate expenditure row {code} {year} {kind}" for (code, year, kind), count in keys.items() if count > 1
    )

    worst, compared, problems = reconcile_expenditure_subtotals(gate.expenditure_facts, gate.budget_facts)
    gate.errors.extend(problems)

    per_year: dict[str, object] = {}
    for year in years:
        rows = [f for f in gate.expenditure_facts if f.year == year]
        budget_regions = {f.region_code for f in gate.budget_facts if f.year == year}
        with_rows = {f.region_code for f in rows}
        without = sorted(budget_regions - with_rows)
        if without:
            gate.warnings.append(f"{len(without)} kabupaten/kota without any expenditure breakdown row for {year}")
        per_year[str(year)] = {
            "rows": len(rows),
            "regions_with_rows": len(with_rows),
            "regions_without_rows": without,
            "null_counts": {
                "budget_amount": sum(f.budget_amount is None for f in rows),
                "realization_amount": sum(f.realization_amount is None for f in rows),
            },
        }
    return {
        "rows": len(gate.expenditure_facts),
        "reconciled_region_years": compared,
        "max_abs_difference": str(worst),
        "years": per_year,
    }


def _check_resources(gate: GateResult, years: tuple[int, ...]) -> dict[str, object]:
    keys = Counter((fact.region_code, fact.year, fact.resource_type) for fact in gate.resource_facts)
    gate.errors.extend(
        f"duplicate resource row {code} {year} {kind}" for (code, year, kind), count in keys.items() if count > 1
    )
    # A missing or unreadable TKDD file is already a blocking DJPK rejection.
    per_year: dict[str, object] = {}
    for year in years:
        rows = [fact for fact in gate.resource_facts if fact.year == year]
        budget_regions = {fact.region_code for fact in gate.budget_facts if fact.year == year}
        with_rows = {fact.region_code for fact in rows}
        without = sorted(budget_regions - with_rows)
        if without:
            gate.warnings.append(f"{len(without)} kabupaten/kota without any natural-resource revenue line for {year}")
        per_year[str(year)] = {
            "rows": len(rows),
            "regions_with_rows": len(with_rows),
            "regions_without_rows": without,
            "realization_by_type": {
                kind: str(sum((f.realization_amount or Decimal(0)) for f in rows if f.resource_type == kind))
                for kind in sorted({f.resource_type for f in rows})
            },
        }
    return {"rows": len(gate.resource_facts), "years": per_year}


def _check_budget(gate: GateResult, regions: list[KemendagriRegion], years: tuple[int, ...]) -> dict[str, object]:
    keys = Counter((fact.region_code, fact.year) for fact in gate.budget_facts)
    gate.errors.extend(f"duplicate budget row {code} {year}" for (code, year), count in keys.items() if count > 1)

    autonomous = {r.code for r in regions if r.province_code not in NON_AUTONOMOUS_PROVINCES}
    coverage: dict[str, object] = {}
    for year in years:
        present = {fact.region_code for fact in gate.budget_facts if fact.year == year}
        missing = sorted(autonomous - present)
        ratio = Decimal(len(present & autonomous)) / Decimal(len(autonomous)) if autonomous else Decimal(0)
        coverage[str(year)] = {
            "expected": len(autonomous),
            "present": len(present & autonomous),
            "ratio": str(ratio.quantize(Decimal("0.0001"))),
            "missing_region_codes": missing,
        }
        if ratio < MIN_BUDGET_COVERAGE:
            gate.errors.append(
                f"budget coverage {year} is {ratio:.2%}, below {MIN_BUDGET_COVERAGE:.0%}: likely an incomplete fetch"
            )
        elif missing:
            gate.warnings.append(f"{len(missing)} kabupaten/kota without DJPK data for {year}")

    nulls = {
        "budget_amount": sum(fact.budget_amount is None for fact in gate.budget_facts),
        "realization_amount": sum(fact.realization_amount is None for fact in gate.budget_facts),
    }
    reduced = sum(fact.reduced_precision for fact in gate.budget_facts)
    if reduced:
        gate.warnings.append(f"{reduced} budget rows use DJPK reduced-precision notation (14 significant digits)")
    return {
        "rows": len(gate.budget_facts),
        "coverage": coverage,
        "null_counts": nulls,
        "zero_counts": {
            "budget_amount": sum(fact.budget_amount == 0 for fact in gate.budget_facts),
            "realization_amount": sum(fact.realization_amount == 0 for fact in gate.budget_facts),
        },
        "reduced_precision_rows": reduced,
        "totals": {
            str(year): {
                "budget_amount": str(sum((f.budget_amount or Decimal(0)) for f in gate.budget_facts if f.year == year)),
                "realization_amount": str(
                    sum((f.realization_amount or Decimal(0)) for f in gate.budget_facts if f.year == year)
                ),
            }
            for year in years
        },
    }


def read_accepted_discrepancies(path: Path) -> set[AcceptedDiscrepancy]:
    with path.open(encoding="utf-8", newline="") as file:
        return {
            AcceptedDiscrepancy(
                year=int(row["year"]),
                metric=row["metric"],
                disaster_type=row["disaster_type"],
                province_sum=int(row["province_sum"]),
                national_total=int(row["national_total"]),
            )
            for row in csv.DictReader(file)
        }


def _check_disasters(
    gate: GateResult,
    bnpb: BnpbResult,
    province_codes: set[str],
    years: tuple[int, ...],
    accepted: set[AcceptedDiscrepancy],
) -> dict[str, object]:
    gate.errors.extend(f"BNPB rejection: {item}" for item in bnpb.rejections)
    unknown = sorted({r.province_code for r in bnpb.records} - province_codes)
    gate.errors.extend(f"BNPB province code not in reference data: {code}" for code in unknown)
    gate.disaster_facts = [r for r in bnpb.records if r.province_code in province_codes]

    aggregates: dict[str, object] = {}
    accepted_hits: list[str] = []
    for year in years:
        rows = [r for r in gate.disaster_facts if r.year == year]
        provinces_by_type: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            provinces_by_type[row.disaster_type].add(row.province_code)
        if set(provinces_by_type) != EXPECTED_DISASTER_TYPES:
            gate.errors.append(f"BNPB {year}: disaster types {sorted(provinces_by_type)} differ from expected")
        for disaster_type, provinces in provinces_by_type.items():
            if provinces != province_codes:
                gate.errors.append(f"BNPB {year} {disaster_type}: {len(provinces)} provinces, expected {len(province_codes)}")

        for metric in ("event_count", "deaths", "missing", "affected"):
            for disaster_type in sorted(EXPECTED_DISASTER_TYPES):
                total = sum(getattr(r, metric) or 0 for r in rows if r.disaster_type == disaster_type)
                reported = bnpb.national_totals.get((year, metric, disaster_type))
                aggregates[f"{year}.{metric}.{disaster_type}"] = {"sum": total, "national_total": reported}
                if reported is None:
                    gate.warnings.append(f"BNPB {year} {metric} {disaster_type}: no national total to compare")
                elif reported != total:
                    message = f"BNPB {year} {metric} {disaster_type}: provinces sum to {total}, national total says {reported}"
                    # Only the exact reviewed figures are tolerated; any new or changed gap still blocks.
                    discrepancy = AcceptedDiscrepancy(year, metric, disaster_type, total, reported)
                    if discrepancy in accepted:
                        gate.warnings.append(f"{message} (accepted discrepancy, see reference/)")
                        gate.accepted_discrepancies.append(discrepancy)
                        accepted_hits.append(f"{year}.{metric}.{disaster_type}")
                        continue
                    gate.errors.append(
                        message
                    )
    return {"rows": len(gate.disaster_facts), "aggregates": aggregates, "accepted_discrepancies": accepted_hits}


def _check_row_delta(gate: GateResult, previous: PreviousVersion | None, accept_row_delta: bool) -> dict[str, object] | None:
    if previous is None:
        return None
    deltas = {}
    for label, before, after in (
        ("budget_rows", previous.budget_rows, len(gate.budget_facts)),
        ("expenditure_rows", previous.expenditure_rows, len(gate.expenditure_facts)),
        ("disaster_rows", previous.disaster_rows, len(gate.disaster_facts)),
    ):
        change = Decimal(abs(after - before)) / Decimal(before) if before else Decimal(0)
        deltas[label] = {"previous": before, "new": after, "change": str(change.quantize(Decimal("0.0001")))}
        if change > MAX_ROW_DELTA:
            message = f"{label} changed {change:.1%} versus active version {previous.version}"
            (gate.warnings if accept_row_delta else gate.errors).append(
                message + (" (accepted after manual review)" if accept_row_delta else "; review, then rerun with --accept-row-delta")
            )
    return {"previous_version": previous.version, "deltas": deltas}


def run_gate(
    djpk: DjpkResult,
    bnpb: BnpbResult,
    matcher: RegionMatcher,
    regions: list[KemendagriRegion],
    province_codes: set[str],
    years: tuple[int, ...],
    previous: PreviousVersion | None,
    accept_row_delta: bool = False,
    accepted_discrepancies: set[AcceptedDiscrepancy] | None = None,
) -> GateResult:
    gate, alias_matches = collect_djpk_facts(djpk, matcher)
    gate.report = {
        "years": list(years),
        "djpk": {
            "rows_read": djpk.rows_read,
            "tkdd_files_read": djpk.tkdd_files_read,
            "rejected": len(djpk.rejections),
            "mapping": {
                "exact": sum(f.match_method == "exact" for f in gate.budget_facts),
                "alias": alias_matches,
            },
            **_check_budget(gate, regions, years),
            "natural_resources": _check_resources(gate, years),
            "expenditure_breakdown": _check_expenditures(gate, years),
        },
        "bnpb": {"rows_read": bnpb.rows_read, **_check_disasters(gate, bnpb, province_codes, years, accepted_discrepancies or set())},
        "row_delta": _check_row_delta(gate, previous, accept_row_delta),
    }
    return gate
