"""Build the BPK opinion artifact.

    uv run python -m jaga_etl.opinions build --csv data/raw/bpk-opini.csv \\
        --output ../../apps/web/src/data/audit-opinions.json
"""

import argparse
import json
from pathlib import Path

from jaga_etl.opinions.build import build

ETL_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REGIONS = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m jaga_etl.opinions")
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--csv", type=Path, required=True)
    build_parser.add_argument("--output", type=Path, required=True)
    build_parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    args = parser.parse_args(argv)
    result = build(args.csv, args.regions, args.output)
    print(json.dumps({"regions": result.regions, "provinces": result.provinces}))


if __name__ == "__main__":
    main()
