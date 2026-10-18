"""Build hospital and school counts.

    uv run python -m jaga_etl.places fetch --cache data/raw/places
    uv run python -m jaga_etl.places build --hospitals data/raw/places/sirs-rs.json \\
        --schools data/raw/places --population data/raw/population/wilayah_penduduk.sql \\
        --output ../../apps/web/src/data/local-services.json
"""

import argparse
import json
import sys
from pathlib import Path

from jaga_etl.places.build import build, fetch_school_pages, refresh_hospitals

ETL_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_REGIONS = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json"
DEFAULT_ALIASES = ETL_ROOT / "reference" / "djpk-aliases.csv"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m jaga_etl.places")
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_parser = sub.add_parser("fetch")
    fetch_parser.add_argument("--cache", type=Path, required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--hospitals", type=Path, required=True)
    build_parser.add_argument("--schools", type=Path, required=True)
    build_parser.add_argument("--output", type=Path, required=True)
    build_parser.add_argument("--population", type=Path, required=True)
    build_parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    build_parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES)
    refresh_parser = sub.add_parser("refresh-hospitals")
    refresh_parser.add_argument("--hospitals", type=Path, required=True)
    refresh_parser.add_argument("--coordinates", type=Path, required=True)
    refresh_parser.add_argument("--boundaries", type=Path, required=True)
    refresh_parser.add_argument("--output", type=Path, required=True)
    refresh_parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS)
    refresh_parser.add_argument("--aliases", type=Path, default=DEFAULT_ALIASES)
    args = parser.parse_args(argv)
    if args.command == "fetch":
        fetch_school_pages(args.cache)
        print(json.dumps({"cached": str(args.cache)}))
        return
    if args.command == "refresh-hospitals":
        omitted = refresh_hospitals(
            args.hospitals,
            args.coordinates,
            args.boundaries,
            args.regions,
            args.aliases,
            args.output,
        )
        print(json.dumps({"hospitals_omitted": omitted}))
        return
    result = build(
        args.hospitals, args.schools, args.regions, args.aliases, args.output, args.population
    )
    if result.schools_unmatched:
        print(json.dumps({"unmatched": result.schools_unmatched}, ensure_ascii=False, indent=2))
        sys.exit(1)
    print(json.dumps({"regions": result.regions, "hospitals_omitted": result.hospitals_omitted}))


if __name__ == "__main__":
    main()
