"""Stage, verify, and atomically activate a dataset version (PRD §9.1).

extract (snapshots) → normalize → map-region → validate → load-staging → quality-check → publish

The API reads only the active dataset version, so staged rows are invisible until the final
activation transaction. Any failure leaves the previously active version untouched and records the
new version as `failed` with its report.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import psycopg

from jaga_etl.facts.bnpb.normalize import normalize as normalize_bnpb
from jaga_etl.facts.bnpb.source import PORTAL as BNPB_PORTAL
from jaga_etl.facts.djpk.mapping import KemendagriProvince, KemendagriRegion, RegionMatcher, read_aliases
from jaga_etl.facts.djpk.normalize import normalize as normalize_djpk
from jaga_etl.facts.djpk.source import PORTAL as DJPK_PORTAL
from jaga_etl.facts.validate import GateResult, PreviousVersion, read_accepted_discrepancies, run_gate
from jaga_etl.snapshot import Manifest, read_snapshot

PIPELINE = "facts:djpk+bnpb"  # DJPK covers APBD and TKDD (natural-resource revenue sharing)


@dataclass(frozen=True)
class PublishOptions:
    djpk_snapshot: Path
    bnpb_snapshot: Path
    years: tuple[int, ...]
    reference_directory: Path
    report_directory: Path
    database_url: str
    write: bool = False
    accept_row_delta: bool = False


@dataclass(frozen=True)
class PublishOutcome:
    passed: bool
    summary: dict[str, object]
    report_path: Path


def _reference(connection: psycopg.Connection) -> tuple[list[KemendagriProvince], list[KemendagriRegion]]:
    with connection.cursor() as cursor:
        cursor.execute("SELECT code, name FROM provinces ORDER BY code")
        provinces = [KemendagriProvince(code=code, name=name) for code, name in cursor.fetchall()]
        cursor.execute(
            "SELECT r.code, r.name, p.code FROM regions r JOIN provinces p ON p.id = r.province_id "
            "WHERE r.is_active ORDER BY r.code"
        )
        regions = [KemendagriRegion(code=code, name=name, province_code=pc) for code, name, pc in cursor.fetchall()]
    return provinces, regions


def _previous(connection: psycopg.Connection) -> PreviousVersion | None:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT v.version, "
            "(SELECT count(*) FROM budget_facts b WHERE b.dataset_version_id = v.id), "
            "(SELECT count(*) FROM expenditure_breakdown_facts e WHERE e.dataset_version_id = v.id), "
            "(SELECT count(*) FROM disaster_facts d WHERE d.dataset_version_id = v.id) "
            "FROM dataset_versions v WHERE v.status = 'active'"
        )
        row = cursor.fetchone()
    return (
        None
        if row is None
        else PreviousVersion(version=row[0], budget_rows=row[1], expenditure_rows=row[2], disaster_rows=row[3])
    )


def version_label(djpk: Manifest, bnpb: Manifest) -> str:
    """Deterministic per snapshot pair, so republishing the same bytes is rejected as a duplicate."""
    return f"{datetime.now(UTC):%Y%m%d}-djpk{djpk.checksum[:8]}-bnpb{bnpb.checksum[:8]}"


def _insert_sources(cursor: psycopg.Cursor, version_id: int, djpk: Manifest, bnpb: Manifest, years: str) -> tuple[int, int]:
    # One row per snapshot (unique per version and checksum): the DJPK snapshot holds both exports.
    ids: list[int] = []
    for publisher, title, url, manifest in (
        (
            "DJPK Kemenkeu",
            "Portal Data SIKD — APBD (Belanja Daerah, periode Desember) dan TKDD (Dana Bagi Hasil SDA) per pemda",
            f"{DJPK_PORTAL}/data/apbd",
            djpk,
        ),
        ("BNPB", "Kompilasi Data Kejadian dan Dampak Bencana (datastore API)", BNPB_PORTAL, bnpb),
    ):
        cursor.execute(
            "INSERT INTO data_sources (dataset_version_id, publisher, title, source_url, period, downloaded_at, checksum_sha256) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (version_id, publisher, title, url, years, manifest.created_at, manifest.checksum),
        )
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError("data_sources insert returned no id")
        ids.append(row[0])
    return ids[0], ids[1]


METRIC_LABELS = {"event_count": "Jumlah kejadian", "deaths": "Korban meninggal", "missing": "Korban hilang", "affected": "Korban terdampak"}
TYPE_LABELS = {
    "banjir": "banjir",
    "cuaca_ekstrem": "cuaca ekstrem",
    "erupsi_gunung_api": "erupsi gunung api",
    "gelombang_pasang_abrasi": "gelombang pasang dan abrasi",
    "gempabumi": "gempabumi",
    "kebakaran_hutan_lahan": "kebakaran hutan dan lahan",
    "kekeringan": "kekeringan",
    "tanah_longsor": "tanah longsor",
    "tsunami": "tsunami",
}


def public_note(year: int, metric: str, disaster_type: str, province_sum: int, national_total: int) -> str:
    """Neutral Indonesian caveat for the profile page; states the facts, assigns no blame."""
    return (
        f"{METRIC_LABELS[metric]} {TYPE_LABELS[disaster_type]} tahun {year}: jumlah seluruh provinsi di data BNPB "
        f"({province_sum}) berbeda dengan total nasional BNPB ({national_total}). Angka provinsi ditampilkan sesuai sumber."
    )


def _stage(
    connection: psycopg.Connection, version_id: int, gate: GateResult, djpk: Manifest, bnpb: Manifest, years: tuple[int, ...]
) -> None:
    period = ",".join(str(year) for year in years)
    with connection.transaction(), connection.cursor() as cursor:
        djpk_source, bnpb_source = _insert_sources(cursor, version_id, djpk, bnpb, period)
        cursor.executemany(
            "INSERT INTO budget_facts (dataset_version_id, region_id, year, budget_amount, realization_amount, source_id) "
            "SELECT %s, r.id, %s, %s, %s, %s FROM regions r WHERE r.code = %s",
            [
                (version_id, f.year, f.budget_amount, f.realization_amount, djpk_source, f.region_code)
                for f in gate.budget_facts
            ],
        )
        cursor.executemany(
            "INSERT INTO natural_resource_revenue_facts (dataset_version_id, region_id, year, resource_type, budget_amount, realization_amount, source_id) "
            "SELECT %s, r.id, %s, %s::natural_resource_type, %s, %s, %s FROM regions r WHERE r.code = %s",
            [
                (version_id, f.year, f.resource_type, f.budget_amount, f.realization_amount, djpk_source, f.region_code)
                for f in gate.resource_facts
            ],
        )
        cursor.executemany(
            "INSERT INTO expenditure_breakdown_facts (dataset_version_id, region_id, year, expenditure_type, budget_amount, realization_amount, source_id) "
            "SELECT %s, r.id, %s, %s::expenditure_type, %s, %s, %s FROM regions r WHERE r.code = %s",
            [
                (version_id, f.year, f.expenditure_type, f.budget_amount, f.realization_amount, djpk_source, f.region_code)
                for f in gate.expenditure_facts
            ],
        )
        cursor.executemany(
            "INSERT INTO disaster_facts (dataset_version_id, province_id, year, disaster_type, event_count, deaths, missing, affected, source_id) "
            "SELECT %s, p.id, %s, %s::disaster_type, %s, %s, %s, %s, %s FROM provinces p WHERE p.code = %s",
            [
                (version_id, d.year, d.disaster_type, d.event_count, d.deaths, d.missing, d.affected, bnpb_source, d.province_code)
                for d in gate.disaster_facts
            ],
        )
        cursor.executemany(
            "INSERT INTO data_notes (dataset_version_id, year, disaster_type, metric, note) VALUES (%s, %s, %s::disaster_type, %s, %s)",
            [
                (version_id, a.year, a.disaster_type, a.metric, public_note(a.year, a.metric, a.disaster_type, a.province_sum, a.national_total))
                for a in gate.accepted_discrepancies
            ],
        )


def _verify_staged(connection: psycopg.Connection, version_id: int, gate: GateResult) -> list[str]:
    """Database-side recount: proves every computed row and total arrived intact (incl. NULLs)."""
    problems: list[str] = []
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT count(*), count(budget_amount), count(realization_amount), "
            "coalesce(sum(budget_amount), 0), coalesce(sum(realization_amount), 0) "
            "FROM budget_facts WHERE dataset_version_id = %s",
            (version_id,),
        )
        row = cursor.fetchone()
        expected = (
            len(gate.budget_facts),
            sum(f.budget_amount is not None for f in gate.budget_facts),
            sum(f.realization_amount is not None for f in gate.budget_facts),
            sum((f.budget_amount or Decimal(0)) for f in gate.budget_facts),
            sum((f.realization_amount or Decimal(0)) for f in gate.budget_facts),
        )
        if row is None or tuple(row) != expected:
            problems.append(f"staged budget rows/totals {row} differ from computed {expected}")

        cursor.execute(
            "SELECT count(*), count(budget_amount), count(realization_amount), "
            "coalesce(sum(budget_amount), 0), coalesce(sum(realization_amount), 0) "
            "FROM natural_resource_revenue_facts WHERE dataset_version_id = %s",
            (version_id,),
        )
        row = cursor.fetchone()
        expected_resources = (
            len(gate.resource_facts),
            sum(f.budget_amount is not None for f in gate.resource_facts),
            sum(f.realization_amount is not None for f in gate.resource_facts),
            sum((f.budget_amount or Decimal(0)) for f in gate.resource_facts),
            sum((f.realization_amount or Decimal(0)) for f in gate.resource_facts),
        )
        if row is None or tuple(row) != expected_resources:
            problems.append(f"staged natural-resource rows/totals {row} differ from computed {expected_resources}")

        cursor.execute(
            "SELECT count(*), count(budget_amount), count(realization_amount), "
            "coalesce(sum(budget_amount), 0), coalesce(sum(realization_amount), 0) "
            "FROM expenditure_breakdown_facts WHERE dataset_version_id = %s",
            (version_id,),
        )
        row = cursor.fetchone()
        expected_expenditures = (
            len(gate.expenditure_facts),
            sum(f.budget_amount is not None for f in gate.expenditure_facts),
            sum(f.realization_amount is not None for f in gate.expenditure_facts),
            sum((f.budget_amount or Decimal(0)) for f in gate.expenditure_facts),
            sum((f.realization_amount or Decimal(0)) for f in gate.expenditure_facts),
        )
        if row is None or tuple(row) != expected_expenditures:
            problems.append(f"staged expenditure rows/totals {row} differ from computed {expected_expenditures}")

        cursor.execute(
            "SELECT count(*), count(event_count), coalesce(sum(event_count), 0), coalesce(sum(deaths), 0) "
            "FROM disaster_facts WHERE dataset_version_id = %s",
            (version_id,),
        )
        row = cursor.fetchone()
        expected_disasters = (
            len(gate.disaster_facts),
            sum(d.event_count is not None for d in gate.disaster_facts),
            sum(d.event_count or 0 for d in gate.disaster_facts),
            sum(d.deaths or 0 for d in gate.disaster_facts),
        )
        if row is None or tuple(row) != expected_disasters:
            problems.append(f"staged disaster rows/totals {row} differ from computed {expected_disasters}")
    return problems


def _activate(connection: psycopg.Connection, version_id: int, run_id: int, report: dict[str, object], loaded: int) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        # The partial unique index allows one active version; retire first, then promote.
        cursor.execute("UPDATE dataset_versions SET status = 'retired' WHERE status = 'active'")
        cursor.execute(
            "UPDATE dataset_versions SET status = 'active', published_at = now(), etl_finished_at = now() WHERE id = %s",
            (version_id,),
        )
        cursor.execute(
            "UPDATE etl_runs SET status = 'succeeded', finished_at = now(), rows_loaded = %s, report = %s WHERE id = %s",
            (loaded, json.dumps(report, default=str), run_id),
        )


def _fail(connection: psycopg.Connection, version_id: int, run_id: int, report: dict[str, object]) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            "UPDATE dataset_versions SET status = 'failed', etl_finished_at = now() WHERE id = %s", (version_id,)
        )
        cursor.execute(
            "UPDATE etl_runs SET status = 'failed', finished_at = now(), report = %s WHERE id = %s",
            (json.dumps(report, default=str), run_id),
        )


def _write_report(directory: Path, report: dict[str, object]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"facts-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return path


def _summary(version: str, gate: GateResult, published: bool) -> dict[str, object]:
    return {
        "dataset_version": version,
        "gate_passed": gate.passed,
        "published": published,
        "budget_rows": len(gate.budget_facts),
        "natural_resource_rows": len(gate.resource_facts),
        "expenditure_rows": len(gate.expenditure_facts),
        "disaster_rows": len(gate.disaster_facts),
        "errors": gate.errors[:20],
        "error_count": len(gate.errors),
        "warnings": gate.warnings,
    }


def run_publish(options: PublishOptions) -> PublishOutcome:
    djpk_manifest, djpk_contents = read_snapshot(options.djpk_snapshot)
    bnpb_manifest, bnpb_contents = read_snapshot(options.bnpb_snapshot)
    djpk = normalize_djpk(djpk_contents, options.years)
    bnpb = normalize_bnpb(bnpb_contents)
    aliases = read_aliases(options.reference_directory / "djpk-aliases.csv")

    with psycopg.connect(options.database_url) as connection:
        provinces, regions = _reference(connection)
        gate = run_gate(
            djpk,
            bnpb,
            RegionMatcher(provinces, regions, aliases),
            regions,
            {p.code for p in provinces},
            options.years,
            _previous(connection),
            options.accept_row_delta,
            read_accepted_discrepancies(options.reference_directory / "bnpb-accepted-discrepancies.csv"),
        )
        report: dict[str, object] = {
            "pipeline": PIPELINE,
            "snapshots": {
                "djpk": {"path": str(options.djpk_snapshot), "checksum": djpk_manifest.checksum, "files": len(djpk_manifest.files)},
                "bnpb": {"path": str(options.bnpb_snapshot), "checksum": bnpb_manifest.checksum, "files": len(bnpb_manifest.files)},
            },
            "gate": {"passed": gate.passed, "errors": gate.errors, "warnings": gate.warnings},
            **gate.report,
        }

        version = version_label(djpk_manifest, bnpb_manifest)
        report["dataset_version"] = version
        if not options.write:
            # Gate-only run: reference tables are read for mapping; nothing is written.
            report["published"] = False
            report_path = _write_report(options.report_directory, report)
            return PublishOutcome(passed=gate.passed, summary=_summary(version, gate, published=False), report_path=report_path)

        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO dataset_versions (version, status, etl_started_at) VALUES (%s, 'staging', now()) RETURNING id",
                (version,),
            )
            version_row = cursor.fetchone()
            if version_row is None:
                raise RuntimeError("dataset_versions insert returned no id")
            version_id = version_row[0]
            cursor.execute(
                "INSERT INTO etl_runs (dataset_version_id, pipeline, rows_read, rows_rejected) VALUES (%s, %s, %s, %s) RETURNING id",
                (version_id, PIPELINE, djpk.rows_read + bnpb.rows_read, len(djpk.rejections) + len(bnpb.rejections)),
            )
            run_row = cursor.fetchone()
            if run_row is None:
                raise RuntimeError("etl_runs insert returned no id")
            run_id = run_row[0]

        passed = gate.passed
        if passed:
            try:
                _stage(connection, version_id, gate, djpk_manifest, bnpb_manifest, options.years)
                problems = _verify_staged(connection, version_id, gate)
                report["staged_verification"] = problems or "ok"
                passed = not problems
                if passed:
                    _activate(
                        connection,
                        version_id,
                        run_id,
                        report,
                        len(gate.budget_facts) + len(gate.resource_facts) + len(gate.disaster_facts),
                    )
            except psycopg.Error as error:
                report["load_error"] = f"{type(error).__name__}: {error}"
                passed = False
        if not passed:
            _fail(connection, version_id, run_id, report)

    report["published"] = passed
    report_path = _write_report(options.report_directory, report)
    return PublishOutcome(passed=passed, summary=_summary(version, gate, published=passed), report_path=report_path)
