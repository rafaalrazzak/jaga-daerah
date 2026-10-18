"""Budget + disaster publication.

Usage (from tools/etl):
    uv run python -m jaga_etl.facts fetch --years 2024,2025
    uv run python -m jaga_etl.facts publish --djpk <snapshot dir> --bnpb <snapshot dir>          # gate only
    uv run python -m jaga_etl.facts publish --djpk <dir> --bnpb <dir> --load [--accept-row-delta]  # stage + activate
"""

import argparse
import json
import os
import sys
from pathlib import Path

from jaga_etl.facts.fetch import fetch_bnpb, fetch_djpk
from jaga_etl.http import PoliteFetcher

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REPORT_DIRECTORY = ETL_ROOT / "reports"
REFERENCE_DIRECTORY = ETL_ROOT / "reference"


def parse_years(value: str) -> tuple[int, ...]:
    years = tuple(sorted({int(item) for item in value.split(",") if item.strip()}))
    if not years or any(year < 2011 or year > 2100 for year in years):
        raise argparse.ArgumentTypeError(f"invalid years: {value}")
    return years


def command_fetch(args: argparse.Namespace) -> int:
    fetcher = PoliteFetcher(delay_seconds=args.delay)
    summary: dict[str, object] = {}
    if "bnpb" in args.sources:
        directory, manifest = fetch_bnpb(RAW_ROOT, fetcher, workers=args.workers)
        summary["bnpb"] = {"snapshot": str(directory), "files": len(manifest.files), "checksum": manifest.checksum}
    if "djpk" in args.sources:
        directory, manifest = fetch_djpk(
            RAW_ROOT, args.years, fetcher, workers=args.workers, resume_snapshot=args.resume_djpk
        )
        summary["djpk"] = {"snapshot": str(directory), "files": len(manifest.files), "checksum": manifest.checksum}
    print(json.dumps(summary, indent=2))
    return 0


def command_publish(args: argparse.Namespace) -> int:
    # Imported lazily so `fetch` does not need the database driver.
    from jaga_etl.facts.publish import PublishOptions, run_publish

    database_url = os.environ.get("ETL_DATABASE_URL")
    if not database_url:
        # Mapping always reads the reference tables; --load additionally writes.
        print("ETL_DATABASE_URL is required.", file=sys.stderr)
        return 2

    outcome = run_publish(
        PublishOptions(
            djpk_snapshot=args.djpk,
            bnpb_snapshot=args.bnpb,
            years=args.years,
            reference_directory=REFERENCE_DIRECTORY,
            report_directory=REPORT_DIRECTORY,
            database_url=database_url,
            write=args.load,
            accept_row_delta=args.accept_row_delta,
        )
    )
    print(json.dumps(outcome.summary, indent=2, ensure_ascii=False))
    print(f"Report: {outcome.report_path}")
    return 0 if outcome.passed else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="DJPK budget + BNPB disaster publication.")
    commands = parser.add_subparsers(dest="command", required=True)

    fetch = commands.add_parser("fetch", help="download sealed raw snapshots")
    fetch.add_argument("--years", type=parse_years, required=True)
    fetch.add_argument(
        "--delay", type=float, default=0.5, help="minimum seconds between request starts (all workers)"
    )
    fetch.add_argument("--workers", type=int, default=4, choices=range(1, 9), metavar="1-8")
    fetch.add_argument("--sources", type=lambda v: set(v.split(",")), default={"djpk", "bnpb"})
    fetch.add_argument("--resume-djpk", metavar="SNAPSHOT_ID", help="continue an interrupted DJPK snapshot")
    fetch.set_defaults(handler=command_fetch)

    publish = commands.add_parser("publish", help="validate snapshots, optionally stage and activate")
    publish.add_argument("--djpk", type=Path, required=True)
    publish.add_argument("--bnpb", type=Path, required=True)
    publish.add_argument("--years", type=parse_years, default=(2024, 2025))
    publish.add_argument("--load", action="store_true")
    publish.add_argument(
        "--accept-row-delta",
        action="store_true",
        help="record manual review of a >10%% row-count change versus the active version",
    )
    publish.set_defaults(handler=command_publish)

    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
