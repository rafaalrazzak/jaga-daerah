"""Build the web expenditure-breakdown artifact from the sealed DJPK snapshot.

Offline by construction: this reads the sealed APBD exports and the region reference already on
disk, never a database and never the network. `jaga_etl.facts publish` is the database path; this is
the path that lets the static profile page render the section without a running PostgreSQL, exactly
as `nature` and `weather` do for their modules.

What it publishes, and the threshold: one module per (region, year) DJPK reported a Belanja Daerah
row for. A region-year whose sumber carries no jenis lines at all is still published, with an empty
`by_type` and status `unavailable` — the same thing the API module returns — so the static section
and the API cannot disagree about what "no data" looks like. Status is `complete` when all ten jenis
are present with both amounts, `partial` when any reported amount is blank, and `unavailable` when
there are no rows; that mirrors the API's rule exactly.

The reconciliation the database gate enforces is enforced here too, through the same function
(`facts.validate.reconcile_expenditure_subtotals`), so the two paths cannot drift apart.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from jaga_etl.facts.djpk.mapping import KemendagriProvince, KemendagriRegion, RegionMatcher
from jaga_etl.facts.djpk.normalize import DjpkResult, normalize as normalize_djpk
from jaga_etl.facts.djpk.source import PORTAL
from jaga_etl.facts.validate import (
    EXPENDITURE_TOLERANCE,
    GateResult,
    collect_djpk_facts,
    reconcile_expenditure_subtotals,
)
from jaga_etl.snapshot import Manifest

# Provenance shown next to the figures. DJPK's export carries a single "Anggaran" column, so the
# repo's existing ambiguity note is repeated here verbatim: the portal never says whether the figure
# is the original or the revised APBD.
PUBLISHER = "DJPK Kemenkeu"
TITLE = "Portal Data SIKD — APBD (rincian belanja menurut jenis) per pemda"
SOURCE_URL = f"{PORTAL}/data/apbd"
ROUNDING_NOTE = (
    "DJPK membulatkan setiap angka yang dipublikasikan, sehingga jumlah seluruh jenis belanja dapat "
    "berbeda sedikit (di bawah Rp1) dari total belanja daerah yang DJPK sendiri publikasikan."
)
MURNI_PERUBAHAN_NOTE = (
    "Ekspor DJPK hanya memuat satu kolom \"Anggaran\" dan tidak menyatakan apakah angka itu APBD "
    "murni (sebelum perubahan) atau APBD perubahan. Kolom ini karena itu tidak diberi label murni "
    "atau perubahan."
)
SCOPE_NOTE = (
    "Rincian ini memakai klasifikasi baku APBD menurut jenis belanja, bukan belanja per program "
    "atau per OPD, sehingga tidak dapat dipakai untuk menilai satu kegiatan tertentu."
)

# Indonesian labels for the ten jenis, in the order the page ranks them when realisations tie.
# The API's `services/expenditure-breakdown.ts` holds the same table for the database path; the
# contract stores the stable enum, so only the display copy lives in two places.
EXPENDITURE_LABELS: dict[str, str] = {
    "belanja_pegawai": "Belanja pegawai",
    "belanja_barang_dan_jasa": "Belanja barang dan jasa",
    "belanja_modal": "Belanja modal",
    "belanja_bunga": "Belanja bunga",
    "belanja_subsidi": "Belanja subsidi",
    "belanja_hibah": "Belanja hibah",
    "belanja_bantuan_sosial": "Belanja bantuan sosial",
    "belanja_bagi_hasil": "Belanja bagi hasil",
    "belanja_bantuan_keuangan": "Belanja bantuan keuangan",
    "belanja_tidak_terduga": "Belanja tidak terduga",
}
JENIS_COUNT = len(EXPENDITURE_LABELS)
CENTS = Decimal("0.01")
# The contract's RupiahSchema / PercentSchema, re-stated so the artifact is rejected here rather
# than by the web build.
RUPIAH_PATTERN = re.compile(r"^\d{1,18}\.\d{2}$")
PERCENT_PATTERN = re.compile(r"^\d{1,4}\.\d$")


class QualityGateError(Exception):
    """Raised with every problem found, so one run reports all of them instead of the first."""

    def __init__(self, problems: list[str]) -> None:
        self.problems = problems
        super().__init__(f"Expenditure quality gate failed ({len(problems)} problem(s)): " + "; ".join(problems[:5]))


@dataclass
class ArtifactResult:
    payload: dict[str, object]
    coverage: dict[str, object] = field(default_factory=dict)


def to_cents(value: Decimal) -> int:
    """Exact cents from a value the parser already quantised; never through a float."""
    return int(value.quantize(CENTS, rounding=ROUND_HALF_UP).scaleb(2).to_integral_value())


def rupiah(value: Decimal | None) -> str | None:
    """Rupiah as a decimal string with two places, matching the contract's RupiahSchema."""
    return None if value is None else f"{value.quantize(CENTS, rounding=ROUND_HALF_UP):.2f}"


def share_percent(amount: Decimal | None, whole: Decimal | None) -> str | None:
    """Share of the published total, one decimal, in exact integer arithmetic.

    Same arithmetic as the API's `sharePercent`: tenths = round_half_up(amount / whole * 1000).
    NULL when either side is unknown or the total is zero ("data tidak cukup"), never 0%.
    """
    if amount is None or whole is None:
        return None
    whole_cents = to_cents(whole)
    if whole_cents == 0:
        return None
    tenths = (to_cents(amount) * 2000 + whole_cents) // (whole_cents * 2)
    return f"{tenths // 10}.{tenths % 10}"


def _narrative(region_name: str, year: int, rows: list[dict[str, object]]) -> list[str]:
    meaning = (
        "Rincian ini memakai klasifikasi baku APBD menurut jenis belanja (misalnya belanja pegawai, "
        "barang dan jasa, modal). Rincian ini bukan belanja per program atau per dinas, sehingga "
        "tidak dapat dipakai untuk menilai satu kegiatan tertentu."
    )
    if not rows:
        return [
            f"Data DJPK tahun {year} tidak memuat rincian belanja menurut jenis untuk {region_name}.",
            meaning,
        ]
    if len(rows) == JENIS_COUNT:
        first = (
            f"Pada tahun {year}, belanja daerah {region_name} terbagi ke {len(rows)} jenis belanja "
            "menurut klasifikasi APBD; jumlah seluruh jenis sama dengan total belanja daerah yang "
            "dipublikasikan."
        )
    else:
        first = (
            f"Pada tahun {year}, {len(rows)} jenis belanja {region_name} tercatat pada data DJPK; "
            "jenis yang tidak dilaporkan sumber tidak ditampilkan, dan sel yang kosong ditandai "
            '"Data belum tersedia".'
        )
    return [first, meaning]


def _module(region_name: str, year: int, rows: list[tuple[str, Decimal | None, Decimal | None]],
            parent_budget: Decimal | None, parent_realization: Decimal | None) -> dict[str, object]:
    """Assemble one region-year module, shaped exactly like the API's ExpenditureBreakdownModule.

    `status` mirrors `services/expenditure-breakdown.ts` field for field: `unavailable` with no rows,
    `partial` when any reported amount is blank, otherwise `complete`. A sumber that simply does not
    report a jenis (many pemda do not budget, say, belanja bunga) still yields `complete`, because
    every figure the source DID state is present and exact — the module never claims the ten jenis
    are all reported. Inventing a stricter rule here is what would make the static page and the API
    disagree about the same bytes.
    """
    by_type = [
        {
            "type": jenis,
            "label": EXPENDITURE_LABELS[jenis],
            "budget_amount": rupiah(budget),
            "realization_amount": rupiah(realization),
            "budget_share_percent": share_percent(budget, parent_budget),
            "realization_share_percent": share_percent(realization, parent_realization),
        }
        for jenis, budget, realization in rows
    ]
    # Largest realisation first; unknown amounts last, then by label for a stable order.
    by_type.sort(key=lambda row: (
        row["realization_amount"] is None,
        -(to_cents(Decimal(row["realization_amount"])) if row["realization_amount"] is not None else 0),
        row["label"],
    ))

    if not by_type:
        status = "unavailable"
    elif any(
        row["budget_amount"] is None or row["realization_amount"] is None for row in by_type
    ):
        status = "partial"
    else:
        status = "complete"

    complete = all(row["budget_amount"] is not None for row in by_type)
    complete_realization = all(row["realization_amount"] is not None for row in by_type)
    return {
        "status": status,
        "total_budget_amount": (
            rupiah(sum((Decimal(row["budget_amount"]) for row in by_type if row["budget_amount"]), Decimal(0)))
            if by_type and complete
            else None
        ),
        "total_realization_amount": (
            rupiah(sum((Decimal(row["realization_amount"]) for row in by_type if row["realization_amount"]), Decimal(0)))
            if by_type and complete_realization
            else None
        ),
        "by_type": by_type,
        "narrative": _narrative(region_name, year, by_type),
    }


def build(
    facts: GateResult,
    names: dict[str, str],
    manifest: Manifest | None,
    years: tuple[int, ...],
    snapshot_id: str | None = None,
) -> ArtifactResult:
    """Assemble one module per region-year, keyed by Kemendagri code then year."""
    rows_by_key: dict[tuple[str, int], list[tuple[str, Decimal | None, Decimal | None]]] = {}
    for fact in facts.expenditure_facts:
        rows_by_key.setdefault((fact.region_code, fact.year), []).append(
            (fact.expenditure_type, fact.budget_amount, fact.realization_amount)
        )
    budgets = {(f.region_code, f.year): f for f in facts.budget_facts}

    regions: dict[str, dict[str, object]] = {}
    unavailable: list[str] = []
    # Every region-year either source reported gets a module, so a year the API can serve also has a
    # static answer. A region-year with no budget row still resolves: its parent totals are NULL,
    # which is "unavailable", never zero.
    for code, year in sorted(set(budgets) | set(rows_by_key)):
        name = names.get(code)
        if name is None:
            raise QualityGateError([f"region {code} has facts but no name in the region reference"])
        if year not in years:
            raise QualityGateError([f"region {code} has facts for unrequested year {year}"])
        budget = budgets.get((code, year))
        rows = sorted(rows_by_key.get((code, year), []), key=lambda row: row[0])
        module = _module(
            name,
            year,
            rows,
            None if budget is None else budget.budget_amount,
            None if budget is None else budget.realization_amount,
        )
        region = regions.setdefault(code, {"name": name, "years": {}})
        years_map = region["years"]
        assert isinstance(years_map, dict)
        years_map[str(year)] = module
        if module["status"] == "unavailable":
            unavailable.append(f"{code} {year}")

    worst, compared, problems = reconcile_expenditure_subtotals(
        facts.expenditure_facts, facts.budget_facts
    )
    if problems:
        raise QualityGateError(problems)

    years_expected = {str(year) for year in years}
    missing_years = sorted(
        {year for code in regions for year in regions[code]["years"] if year not in years_expected}
    )
    if missing_years:
        raise QualityGateError([f"artifact holds years outside the requested set: {missing_years}"])

    payload: dict[str, object] = {
        "source": {
            "publisher": PUBLISHER,
            "title": TITLE,
            "url": SOURCE_URL,
            "labels": EXPENDITURE_LABELS,
            "jenis_count": JENIS_COUNT,
            "rounding_note": ROUNDING_NOTE,
            "murni_perubahan_note": MURNI_PERUBAHAN_NOTE,
            "scope_note": SCOPE_NOTE,
            "snapshot_created_at": None if manifest is None else manifest.created_at,
            "snapshot_id": snapshot_id,
            "snapshot_checksum": None if manifest is None else manifest.checksum,
            # The static artifact has no `dataset_versions` row; the snapshot it was built from is its
            # version. Named like the ETL's own label so the page can print one identifier either way.
            "dataset_version": (
                None
                if manifest is None
                else f"{(snapshot_id or manifest.created_at[:10].replace('-', ''))}-djpk{manifest.checksum[:8]}"
            ),
            "processed_at": datetime.now(UTC).isoformat(),
        },
        "regions": regions,
    }
    coverage = {
        "region_years": compared,
        "status_counts": {
            status: sum(
                1
                for code in regions
                for module in regions[code]["years"].values()  # type: ignore[union-attr]
                if module["status"] == status
            )
            for status in ("complete", "partial", "unavailable")
        },
        "regions": len(regions),
        "max_abs_difference": str(worst),
        "tolerance": str(EXPENDITURE_TOLERANCE),
        "unavailable_region_years": unavailable,
    }
    return ArtifactResult(payload=payload, coverage=coverage)


def check(payload: dict[str, object]) -> list[str]:
    """Independent re-read of the assembled artifact: shape and range checks the contract relies on.

    These mirror the Zod schema (`ExpenditureBreakdownModuleSchema`) so a value the web build would
    reject cannot reach the committed file: money as `N.NN`, percent as `N.N`, no negatives, and
    every jenis a known enum member.
    """
    problems: list[str] = []

    regions = payload["regions"]
    assert isinstance(regions, dict)
    for code, region in sorted(regions.items()):
        assert isinstance(region, dict)
        years_map = region["years"]
        assert isinstance(years_map, dict)
        if not years_map:
            problems.append(f"{code}: no published year")
        for year, module in sorted(years_map.items()):
            assert isinstance(module, dict)
            by_type = module["by_type"]
            assert isinstance(by_type, list)
            seen: set[str] = set()
            for row in by_type:
                assert isinstance(row, dict)
                jenis = row["type"]
                if jenis not in EXPENDITURE_LABELS:
                    problems.append(f"{code} {year}: unknown jenis {jenis!r}")
                    continue
                if jenis in seen:
                    problems.append(f"{code} {year}: jenis {jenis} appears twice")
                seen.add(jenis)
                if row["label"] != EXPENDITURE_LABELS[jenis]:
                    problems.append(f"{code} {year}: label for {jenis} is not the reviewed label")
                for field in ("budget_amount", "realization_amount"):
                    value = row[field]
                    if value is not None and not RUPIAH_PATTERN.fullmatch(str(value)):
                        problems.append(f"{code} {year} {jenis}: {field} {value!r} is not a rupiah string")
                for field in ("budget_share_percent", "realization_share_percent"):
                    value = row[field]
                    if value is not None and not PERCENT_PATTERN.fullmatch(str(value)):
                        problems.append(f"{code} {year} {jenis}: {field} {value!r} is not a percent string")
                if module["status"] == "complete" and (
                    row["budget_amount"] is None or row["realization_amount"] is None
                ):
                    problems.append(f"{code} {year}: status is complete but a jenis amount is missing")
                if module["status"] == "unavailable" and by_type:
                    problems.append(f"{code} {year}: status is unavailable but rows exist")
            if module["status"] != "unavailable" and not module["narrative"]:
                problems.append(f"{code} {year}: narrative missing")
    return problems


def write_report(report: dict[str, object], directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"expenditure-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8")
    return path
