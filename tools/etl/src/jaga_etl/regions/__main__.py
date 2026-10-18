"""Run the region reference import: extract → normalize → validate → load → report.

Usage (from tools/etl):
    uv run python -m jaga_etl.regions            # validate only, no database writes
    uv run python -m jaga_etl.regions --load     # also load using ETL_DATABASE_URL
"""

import argparse
import json
import os
import sys
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import NormalizedRegions, normalize
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.regions.validate import read_official_counts, validate
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_DIRECTORY = ETL_ROOT / "data" / "raw"
REPORT_DIRECTORY = ETL_ROOT / "reports"
OFFICIAL_RECAP = ETL_ROOT / "reference" / "kepmendagri-300.2.2-2430-2025-recap.csv"


def export_web(data: NormalizedRegions, path: Path) -> None:
    """Static route list: lets Astro prerender one page per kab/kota without a build-time API call."""
    provinces = {p.code: p for p in data.provinces}
    regions = [
        {
            "code": r.code,
            "name": r.name,
            "slug": r.slug,
            "type": r.type,
            "province": {
                "code": r.province_code,
                "name": provinces[r.province_code].name,
                "slug": provinces[r.province_code].slug,
            },
        }
        for r in sorted(data.regions, key=lambda item: item.code)
    ]
    write_json(path, regions)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Kepmendagri province/region codes.")
    parser.add_argument("--load", action="store_true", help="write validated data to PostgreSQL")
    parser.add_argument(
        "--export-web",
        type=Path,
        help="write the validated region list as JSON for static profile pages (apps/web)",
    )
    args = parser.parse_args()

    raw_file = extract(REGION_CODE_SOURCE, RAW_DIRECTORY)
    data = normalize(raw_file.path.read_text(encoding="utf-8"))
    result = validate(data, read_official_counts(OFFICIAL_RECAP))

    report: dict[str, object] = {
        "pipeline": "regions",
        "started_at": datetime.now(UTC).isoformat(),
        "source": asdict(REGION_CODE_SOURCE),
        "raw_file": {"path": raw_file.path.name, "sha256": raw_file.sha256, "downloaded_at": raw_file.downloaded_at},
        "rows": {
            "provinces": len(data.provinces),
            "regions": len(data.regions),
            "kabupaten": sum(r.type == "kabupaten" for r in data.regions),
            "kota": sum(r.type == "kota" for r in data.regions),
            "rejected": len(data.rejections),
        },
        "quality_gate": {"passed": result.is_valid, "errors": result.errors},
        "load": None,
    }

    exit_code = 0
    if result.is_valid and args.export_web is not None:
        export_web(data, args.export_web)
    if not result.is_valid:
        exit_code = 1
    elif args.load:
        database_url = os.environ.get("ETL_DATABASE_URL")
        if not database_url:
            print("ETL_DATABASE_URL is required with --load.", file=sys.stderr)
            return 2

        # Imported lazily so validation-only runs do not need the database driver.
        import psycopg

        from jaga_etl.regions.load import load

        with psycopg.connect(database_url) as connection:
            report["load"] = asdict(load(connection, data))

    REPORT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIRECTORY / f"regions-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps({k: report[k] for k in ("rows", "quality_gate", "load")}, ensure_ascii=False))
    print(f"Report: {report_path}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
