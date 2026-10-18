"""Build `apps/web/src/data/expenditure.json` from the sealed DJPK snapshot.

Offline only: it reads the sealed APBD exports plus the checked-in region reference, so it needs no
database, no network and no running Worker — the same footing as `jaga_etl.nature` and
`jaga_etl.weather`. The database publication (`jaga_etl.facts publish`) remains the API's path; this
is the path that lets the static profile page render the section without PostgreSQL.

    uv run python -m jaga_etl.expenditure \
      --snapshot data/raw/djpk/20261017T094824Z \
      --output ../../apps/web/src/data/expenditure.json
"""

import argparse
import json
import sys
from pathlib import Path

from jaga_etl.expenditure.build import QualityGateError, build, check, write_report
from jaga_etl.facts.djpk.mapping import (
    KemendagriProvince,
    KemendagriRegion,
    RegionMatcher,
    read_aliases,
)
from jaga_etl.facts.djpk.normalize import normalize as normalize_djpk
from jaga_etl.facts.validate import collect_djpk_facts
from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import normalize as normalize_regions
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import SnapshotError, read_snapshot
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REFERENCE = ETL_ROOT / "reference"
REPORT_DIRECTORY = ETL_ROOT / "reports"
DEFAULT_YEARS = (2024, 2025)


def region_reference() -> tuple[list[KemendagriProvince], list[KemendagriRegion]]:
    """The Kemendagri provinces and kabupaten/kota, read offline from the verified raw dump.

    `extract` reuses an existing raw file whose checksum still matches the pinned source, so this
    needs no network once `etl:regions` has run once — and it fails loudly on a tampered file rather
    than silently mapping against a different region list than the rest of the product uses.
    """
    dump = extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8")
    normalized = normalize_regions(dump)
    provinces = [KemendagriProvince(code=p.code, name=p.name) for p in normalized.provinces]
    regions = [
        KemendagriRegion(code=r.code, name=r.name, province_code=r.province_code)
        for r in normalized.regions
    ]
    return provinces, regions


def main() -> int:
    parser = argparse.ArgumentParser(description="Build apps/web expenditure-breakdown data.")
    parser.add_argument("--output", type=Path, help="artifact path (required to write)")
    parser.add_argument("--snapshot", type=Path, help="sealed DJPK snapshot directory")
    parser.add_argument("--years", default=",".join(str(y) for y in DEFAULT_YEARS))
    parser.add_argument("--reference", type=Path, default=REFERENCE, help="reference directory")
    args = parser.parse_args()

    snapshot = args.snapshot
    if snapshot is None:
        candidates = sorted((RAW_ROOT / "djpk").glob("*/manifest.json"))
        if not candidates:
            print("No sealed DJPK snapshot; run `bun run etl:fetch` first.", file=sys.stderr)
            return 1
        snapshot = candidates[-1].parent

    try:
        years = tuple(sorted({int(item) for item in args.years.split(",") if item.strip()}))
    except ValueError:
        print(f"invalid --years: {args.years!r}", file=sys.stderr)
        return 1
    if not years:
        print("--years must list at least one year", file=sys.stderr)
        return 1

    try:
        manifest, contents = read_snapshot(snapshot)
    except SnapshotError as error:
        print(str(error), file=sys.stderr)
        return 1

    provinces, regions = region_reference()
    matcher = RegionMatcher(provinces, regions, read_aliases(args.reference / "djpk-aliases.csv"))
    names = {region.code: region.name for region in regions}

    djpk = normalize_djpk(contents, years)
    facts, alias_matches = collect_djpk_facts(djpk, matcher)
    if facts.errors:
        report = {"quality_gate": "failed", "problems": facts.errors}
        path = write_report(report, REPORT_DIRECTORY)
        print(json.dumps(report, indent=2, ensure_ascii=False), file=sys.stderr)
        print(f"Report: {path}")
        return 1

    try:
        result = build(facts, names, manifest, years, snapshot.name)
    except QualityGateError as error:
        report = {"quality_gate": "failed", "problems": error.problems}
        path = write_report(report, REPORT_DIRECTORY)
        print(str(error), file=sys.stderr)
        print(f"Report: {path}")
        return 1

    problems = check(result.payload)
    if problems:
        report = {"quality_gate": "failed", "problems": problems}
        path = write_report(report, REPORT_DIRECTORY)
        print(json.dumps(report, indent=2, ensure_ascii=False), file=sys.stderr)
        print(f"Report: {path}")
        return 1

    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        write_json(args.output, result.payload)

    summary: dict[str, object] = {
        "quality_gate": "passed",
        "snapshot": str(snapshot),
        "snapshot_checksum": manifest.checksum,
        "years": list(years),
        "output": None if args.output is None else str(args.output),
        "alias_matches": alias_matches,
        **result.coverage,
    }
    path = write_report(summary, REPORT_DIRECTORY)
    print(json.dumps(summary, ensure_ascii=False))
    print(f"Report: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
