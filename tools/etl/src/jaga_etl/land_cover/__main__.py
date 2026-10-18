"""Build the provincial land-cover artifact.

    uv run python -m jaga_etl.land_cover build --table data/raw/land-cover/pktl-2023.txt \\
        --output ../../apps/web/src/data/land-cover.json
"""

import argparse
import json
import sys
from pathlib import Path

from jaga_etl.land_cover.build import build

ETL_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REGIONS = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json"
DEFAULT_ALIASES = ETL_ROOT / "reference" / "djpk-aliases.csv"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m jaga_etl.land_cover")
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--table", type=Path, required=True)
    build_parser.add_argument("--output", type=Path, required=True)
    build_parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    build_parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES)
    args = parser.parse_args(argv)
    result = build(args.table, args.regions, args.aliases, args.output)
    if result.unmatched:
        print(json.dumps({"unmatched": result.unmatched}, ensure_ascii=False, indent=2))
        sys.exit(1)
    print(json.dumps({"provinces": result.provinces}))


if __name__ == "__main__":
    main()
