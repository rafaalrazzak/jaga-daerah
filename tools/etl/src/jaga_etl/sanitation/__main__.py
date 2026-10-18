"""Fetch and build the sanitation artifact.

    uv run python -m jaga_etl.sanitation fetch --snapshot-root data/raw
    uv run python -m jaga_etl.sanitation build --page data/raw/sanitation/<id>/page.html \\
        --output ../../apps/web/src/data/sanitation.json
"""

import argparse
import json
import sys
from pathlib import Path

from jaga_etl.http import PoliteFetcher
from jaga_etl.sanitation.build import build
from jaga_etl.sanitation.parse import PAGE_URL, SanitationError, extract_table
from jaga_etl.snapshot import SnapshotWriter

ETL_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REGIONS = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m jaga_etl.sanitation")
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_parser = sub.add_parser("fetch")
    fetch_parser.add_argument("--snapshot-root", type=Path, required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--page", type=Path, required=True)
    build_parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    build_parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "fetch":
            page = _fetch(args.snapshot_root)
            print(json.dumps({"page": str(page)}))
            return
        result = build(args.page, args.regions, args.output)
    except (SanitationError, UnicodeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"regions": result.regions, "blank": result.blank}))


def _fetch(root: Path) -> Path:
    body = PoliteFetcher().get(PAGE_URL)
    extract_table(body.decode("utf-8"))
    writer = SnapshotWriter(root, "sanitation")
    writer.add("page.html", PAGE_URL, body)
    writer.seal()
    return writer.directory / "page.html"


if __name__ == "__main__":
    main()
