"""Publication against a real, disposable PostgreSQL with the committed migrations and role grants.

Skipped when PostgreSQL binaries are unavailable. Uses the same approach as the API's DB tests:
initdb into a temp directory, trust auth on loopback, `bun run db:migrate` for the real migrator.
"""

import os
import shutil
import socket
import subprocess
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

from facts_fixtures import PROVINCES, REGIONS, bnpb_contents, djpk_contents, write_snapshot
from jaga_etl.facts.publish import PublishOptions, run_publish

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE = Path(__file__).resolve().parents[1] / "reference"
WINDOWS_INSTALL_ROOT = Path("C:/Program Files/PostgreSQL")


def _bin_directory() -> Path | None:
    configured = os.environ.get("POSTGRES_BIN_DIR")
    if configured:
        return Path(configured)
    pg_config = shutil.which("pg_config")
    if pg_config:
        return Path(subprocess.check_output([pg_config, "--bindir"], text=True).strip())
    if WINDOWS_INSTALL_ROOT.exists():
        versions = sorted((p for p in WINDOWS_INSTALL_ROOT.iterdir() if p.name.isdigit()), key=lambda p: int(p.name))
        if versions:
            return versions[-1] / "bin"
    return None


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@pytest.fixture(scope="module")
def database(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, str]]:
    bin_directory = _bin_directory()
    if bin_directory is None:
        pytest.skip("PostgreSQL binaries not found (set POSTGRES_BIN_DIR)")
    data = tmp_path_factory.mktemp("pg")
    port = _free_port()
    subprocess.run(
        [str(bin_directory / "initdb"), "-D", str(data), "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale", "C"],
        check=True,
        capture_output=True,
    )
    # Ubuntu's packaged server writes the socket lock under /var/run/postgresql, which the
    # CI user cannot create. Tests connect over TCP. Windows builds do not have that parameter.
    socket_option = "" if os.name == "nt" else f" -c unix_socket_directories={data}"
    started = subprocess.run(
        [str(bin_directory / "pg_ctl"), "start", "-D", str(data), "-w", "-l", str(data / "server.log"),
         "-o", f"-p {port} -c listen_addresses=127.0.0.1 -c fsync=off{socket_option}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if started.returncode != 0:
        log_path = data / "server.log"
        log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
        raise RuntimeError(f"pg_ctl start failed with exit code {started.returncode}\n{log}")
    def url(role: str) -> str:
        return f"postgresql://{role}:unused@127.0.0.1:{port}/jaga_daerah"

    try:
        with psycopg.connect(f"postgresql://postgres@127.0.0.1:{port}/postgres", autocommit=True) as admin:
            admin.execute("CREATE DATABASE jaga_daerah")
            admin.execute("CREATE ROLE jaga_etl LOGIN")
            admin.execute("CREATE ROLE jaga_readonly LOGIN")
        subprocess.run(
            ["bun", "run", "db:migrate"],
            cwd=REPO_ROOT,
            env={**os.environ, "MIGRATION_DATABASE_URL": url("postgres")},
            check=True,
            capture_output=True,
        )
        with psycopg.connect(url("postgres"), autocommit=True) as owner:
            for script in ("runtime-readonly.sql", "etl-writer.sql"):
                owner.execute((REPO_ROOT / "database" / "roles" / script).read_text(encoding="utf-8"))
            for province in PROVINCES:
                owner.execute(
                    "INSERT INTO provinces (code, name, slug) VALUES (%s, %s, %s)",
                    (province.code, province.name, province.name.lower().replace(" ", "-")),
                )
            for region in REGIONS:
                owner.execute(
                    "INSERT INTO regions (province_id, code, name, slug, type) "
                    "SELECT id, %s, %s, %s, %s FROM provinces WHERE code = %s",
                    (region.code, region.name, region.name.lower().replace(" ", "-"),
                     "kota" if region.name.startswith("Kota") else "kabupaten", region.province_code),
                )
        yield {"etl": url("jaga_etl"), "owner": url("postgres")}
    finally:
        subprocess.run([str(bin_directory / "pg_ctl"), "stop", "-D", str(data), "-m", "immediate", "-w"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _publish(tmp_path: Path, database: dict[str, str], snapshot_id: str, **overrides) -> object:
    djpk = write_snapshot(tmp_path / "raw", "djpk", overrides.pop("djpk", djpk_contents()), snapshot_id)
    bnpb = write_snapshot(tmp_path / "raw", "bnpb", overrides.pop("bnpb", bnpb_contents()), snapshot_id)
    return run_publish(
        PublishOptions(
            djpk_snapshot=djpk,
            bnpb_snapshot=bnpb,
            years=(2024, 2025),
            reference_directory=overrides.pop("reference_directory", REFERENCE),
            report_directory=tmp_path / "reports",
            database_url=database["etl"],
            write=True,
            **overrides,
        )
    )


def _active(owner_url: str) -> list[tuple[str, str]]:
    with psycopg.connect(owner_url) as connection:
        return connection.execute(
            "SELECT version, status::text FROM dataset_versions WHERE status = 'active'"
        ).fetchall()


def test_publishes_staged_facts_atomically_with_provenance(database: dict[str, str], tmp_path: Path):
    outcome = _publish(tmp_path, database, "first")

    assert outcome.passed, outcome.summary
    with psycopg.connect(database["owner"]) as connection:
        version_id, status = connection.execute(
            "SELECT id, status::text FROM dataset_versions WHERE version = %s", (outcome.summary["dataset_version"],)
        ).fetchone()
        assert status == "active"
        budget = dict(
            connection.execute(
                "SELECT r.code || ':' || b.year, b.realization_amount::text FROM budget_facts b "
                "JOIN regions r ON r.id = b.region_id WHERE b.dataset_version_id = %s",
                (version_id,),
            ).fetchall()
        )
        assert budget["32.73:2025"] == "7490617461211.10"  # exact decimal, never a float
        assert budget["11.71:2025"] == "0.00"  # reported zero stays zero
        nulls = connection.execute(
            "SELECT count(*) FROM disaster_facts WHERE dataset_version_id = %s AND event_count IS NULL", (version_id,)
        ).fetchone()[0]
        assert nulls == 2  # blank BNPB cells stay NULL (Aceh tsunami, both years)
        resources = dict(
            connection.execute(
                "SELECT r.code || ':' || f.resource_type::text, f.realization_amount::text "
                "FROM natural_resource_revenue_facts f JOIN regions r ON r.id = f.region_id "
                "WHERE f.dataset_version_id = %s AND f.year = 2025",
                (version_id,),
            ).fetchall()
        )
        assert resources == {
            "32.73:gas_bumi": "3000000000.00",
            "32.73:minyak_bumi": "12500000000.00",
            "32.73:panas_bumi": "1150500000000.00",
            "32.04:perkebunan_sawit": "0.00",
        }
        sources = connection.execute(
            "SELECT publisher, length(checksum_sha256) FROM data_sources WHERE dataset_version_id = %s ORDER BY publisher",
            (version_id,),
        ).fetchall()
        assert sources == [("BNPB", 64), ("DJPK Kemenkeu", 64)]
        run = connection.execute(
            "SELECT status::text, rows_loaded, report->'gate'->>'passed' FROM etl_runs WHERE dataset_version_id = %s",
            (version_id,),
        ).fetchone()
        assert run == ("succeeded", 6 + 4 + 36, "true")  # budget + natural-resource + disaster rows


def test_failed_quality_gate_leaves_the_active_version_unchanged(database: dict[str, str], tmp_path: Path):
    before = _active(database["owner"])

    outcome = _publish(tmp_path, database, "tampered", bnpb=bnpb_contents(tamper_total=True))

    assert not outcome.passed
    assert _active(database["owner"]) == before
    with psycopg.connect(database["owner"]) as connection:
        status, facts = connection.execute(
            "SELECT v.status::text, (SELECT count(*) FROM budget_facts b WHERE b.dataset_version_id = v.id) "
            "FROM dataset_versions v WHERE v.version = %s",
            (outcome.summary["dataset_version"],),
        ).fetchone()
    assert (status, facts) == ("failed", 0)


def test_republishing_the_same_snapshots_is_rejected_as_duplicate(database: dict[str, str], tmp_path: Path):
    before = _active(database["owner"])

    with pytest.raises(psycopg.errors.UniqueViolation):
        _publish(tmp_path, database, "repeat")

    assert _active(database["owner"]) == before


def test_etl_role_cannot_delete_published_facts(database: dict[str, str]):
    with psycopg.connect(database["etl"]) as connection, pytest.raises(psycopg.errors.InsufficientPrivilege):
        connection.execute("DELETE FROM budget_facts")


def test_accepted_discrepancy_is_published_with_a_public_note(database: dict[str, str], tmp_path: Path):
    from jaga_etl.facts.bnpb.normalize import normalize as normalize_bnpb

    from jaga_etl.facts.bnpb.source import RESOURCES, resource_file_name

    from facts_fixtures import bnpb_payload

    # Only the event_count resources carry a national-total gap.
    tampered = {
        resource_file_name(r): bnpb_payload(r, PROVINCES, tamper_total=r.metric == "event_count") for r in RESOURCES
    }
    result = normalize_bnpb(tampered)
    year, disaster_type = 2025, "banjir"
    total = sum(r.event_count or 0 for r in result.records if (r.year, r.disaster_type) == (year, disaster_type))
    reported = result.national_totals[(year, "event_count", disaster_type)]
    reference = tmp_path / "reference"
    reference.mkdir()
    shutil.copy(REFERENCE / "djpk-aliases.csv", reference / "djpk-aliases.csv")
    (reference / "bnpb-accepted-discrepancies.csv").write_text(
        "year,metric,disaster_type,province_sum,national_total,note\n"
        f"2024,event_count,banjir,{sum(r.event_count or 0 for r in result.records if (r.year, r.disaster_type) == (2024, 'banjir'))},"
        f"{result.national_totals[(2024, 'event_count', 'banjir')]},test\n"
        f"{year},event_count,{disaster_type},{total},{reported},test\n",
        encoding="utf-8",
    )

    outcome = _publish(tmp_path, database, "noted", bnpb=tampered, reference_directory=reference)

    assert outcome.passed, outcome.summary
    with psycopg.connect(database["owner"]) as connection:
        notes = connection.execute(
            "SELECT n.year, n.disaster_type::text, n.note FROM data_notes n "
            "JOIN dataset_versions v ON v.id = n.dataset_version_id WHERE v.status = 'active' ORDER BY n.year"
        ).fetchall()
    assert [(y, t) for y, t, _ in notes] == [(2024, "banjir"), (2025, "banjir")]
    assert f"({total})" in notes[1][2] and f"({reported})" in notes[1][2]
