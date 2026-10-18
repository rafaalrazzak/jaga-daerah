"""Human-in-the-loop LHKPN figures: worklist → human browser search → saved captures → published JSON.

    uv run python -m jaga_etl.lhkpn captures --limit 10        # write the worklist a human follows
    uv run python -m jaga_etl.lhkpn register                   # SHA-256 every capture the worklist asks for
    uv run python -m jaga_etl.lhkpn build                      # parse + join + gate + write lhkpn.json
    uv run python -m jaga_etl.lhkpn report                     # gate result only, nothing written

Nothing here contacts KPK. The e-Announcement search is reCAPTCHA-gated and offers no public API, so a
human runs each search in a browser and saves the result; these commands only write down the list of
searches, hash the files that human saved, and read those files offline. `docs/decisions/0003` and
`docs/SECURITY.md` ("Personal Data (LHKPN)") fix the labels every published figure must carry.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.lhkpn.build import (
    CAPTURES,
    ETL_ROOT,
    INSTITUTIONS,
    REFERENCE,
    build,
    read_regions,
    register,
    worklist_rows,
    write_payload,
    write_provenance,
    write_worklist,
)
from jaga_etl.lhkpn.parse import CaptureError

WEB_DATA = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data"
DEFAULT_OFFICIALS = WEB_DATA / "officials.json"
DEFAULT_REGIONS = WEB_DATA / "regions.json"
DEFAULT_OUTPUT = WEB_DATA / "lhkpn.json"
# Prove the loop on ten regions before a human runs 514 searches; `--limit 0` covers every region.
PILOT_REGIONS = 10
REPORTS = ETL_ROOT / "reports"


def _shared(subparser: argparse.ArgumentParser) -> None:
    subparser.add_argument("--captures-dir", type=Path, default=CAPTURES, help="saved pages (gitignored)")
    subparser.add_argument("--officials", type=Path, default=DEFAULT_OFFICIALS)
    subparser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    subparser.add_argument("--institutions", type=Path, default=INSTITUTIONS)


def _captures(args: argparse.Namespace) -> int:
    rows = worklist_rows(
        limit=args.limit, regions=read_regions(args.regions, args.officials)
    )
    if not rows:
        print("No region with a head in office: run `jaga_etl.incumbents` first", file=sys.stderr)
        return 1
    write_worklist(rows, args.captures_dir)
    print(
        json.dumps(
            {
                "regions": len(rows),
                "limit": args.limit,
                "worklist": str(args.captures_dir / "worklist.csv"),
                "instructions": str(args.captures_dir / "README.worklist.md"),
            }
        )
    )
    return 0


def _register(args: argparse.Namespace) -> int:
    captures, errors = register(args.captures_dir)
    if errors:
        print("Nothing registered:\n  " + "\n  ".join(errors), file=sys.stderr)
        return 1
    write_provenance(captures, args.captures_dir / "provenance.csv")
    print(json.dumps({"registered": len(captures), "regions": [capture.region_code for capture in captures]}))
    return 0


def _build(args: argparse.Namespace) -> int:
    payload, errors = build(
        captures_dir=args.captures_dir,
        institutions_file=args.institutions,
        officials_file=args.officials,
        regions_file=args.regions,
    )
    if errors:
        # The gate blocks: nothing is written, so a rejected capture never reaches the web app.
        print("LHKPN quality gate failed:\n  " + "\n  ".join(errors[:60]), file=sys.stderr)
        return 1
    write_payload(payload, args.output)
    regions = payload["regions"]
    print(
        json.dumps(
            {
                "regions": len(regions),
                "reports": sum(len(region["reports"]) for region in regions.values()),
                "output": str(args.output),
                "built_at": datetime.now(UTC).isoformat(),
            }
        )
    )
    return 0


def _report(args: argparse.Namespace) -> int:
    """Write the run report the other ETL steps also leave in `reports/` (gitignored)."""
    payload, errors = build(
        captures_dir=args.captures_dir,
        institutions_file=args.institutions,
        officials_file=args.officials,
        regions_file=args.regions,
    )
    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / f"lhkpn-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(
        json.dumps(
            {
                "captures": sorted(capture.name for capture in args.captures_dir.glob("*.html"))
                if args.captures_dir.exists()
                else [],
                "regions": len(payload["regions"]),
                "gate": "passed" if not errors else "failed",
                "errors": errors,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps({"report": str(path), "regions": len(payload["regions"]), "errors": len(errors)}))
    return 1 if errors else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="python -m jaga_etl.lhkpn",
        description="LHKPN figures for regional officials, from pages a human saved by hand.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    captures = subparsers.add_parser("captures", help="write the worklist of searches a human must run")
    _shared(captures)
    captures.add_argument(
        "--limit",
        type=int,
        default=PILOT_REGIONS,
        help=f"regions to cover (default {PILOT_REGIONS}: prove the loop before scaling to all 514; 0 = all)",
    )
    captures.set_defaults(run=_captures)

    register_parser = subparsers.add_parser("register", help="record the SHA-256 of each saved capture")
    _shared(register_parser)
    register_parser.set_defaults(run=_register)

    factory = subparsers.add_parser("build", help="parse captured pages and write apps/web/src/data/lhkpn.json")
    _shared(factory)
    factory.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    factory.set_defaults(run=_build)

    report = subparsers.add_parser("report", help="write the gate result to reports/ without publishing")
    _shared(report)
    report.set_defaults(run=_report)

    args = parser.parse_args()
    if not REFERENCE.exists():  # pragma: no cover - a broken checkout, not a data condition
        print(f"missing reference directory {REFERENCE}", file=sys.stderr)
        return 1
    try:
        return args.run(args)
    except CaptureError as error:
        print(f"unreadable capture: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
