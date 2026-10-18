"""Build the welfare artifact from the three BPS books.

    uv run python -m jaga_etl.welfare build \\
        --poverty data/raw/welfare/kemiskinan-2025.pdf \\
        --pdrb data/raw/welfare/pdrb-2021-2025.pdf \\
        --ipm data/raw/welfare/ipm-2025.pdf \\
        --output ../../apps/web/src/data/welfare.json
"""

import argparse
import json
from pathlib import Path

from jaga_etl.welfare.build import build

ETL_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REGIONS = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m jaga_etl.welfare")
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--poverty", type=Path, required=True)
    build_parser.add_argument("--pdrb", type=Path, required=True)
    build_parser.add_argument("--ipm", type=Path, required=True)
    build_parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    build_parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    result = build(args.poverty, args.pdrb, args.ipm, args.regions, args.output)
    print(
        json.dumps(
            {
                "regions": result.regions,
                "poverty": result.poverty,
                "output": result.output,
                "development": result.development,
            }
        )
    )


if __name__ == "__main__":
    main()
