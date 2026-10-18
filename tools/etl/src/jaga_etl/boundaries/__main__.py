"""Build the web map file from the pinned boundary source.

Usage (from tools/etl):
    uv run python -m jaga_etl.boundaries --output ../../apps/web/public/data/map-regions.json
"""

import argparse
import json
import re
import sys
from pathlib import Path

from jaga_etl.boundaries.build import build_map, parse
from jaga_etl.boundaries.source import COMMIT, kabupaten_files, province_files
from jaga_etl.http import PoliteFetcher
from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import normalize
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import SnapshotError, SnapshotWriter, read_snapshot
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REGION_CODE = re.compile(r"\d{2}\.\d{2}")
PROVINCE_CODE = re.compile(r"\d{2}")


def snapshot(fetcher: PoliteFetcher) -> dict[str, bytes]:
    directory = RAW_ROOT / "boundaries" / COMMIT[:12]
    if (directory / "manifest.json").exists():
        return read_snapshot(directory)[1]
    try:
        writer = SnapshotWriter(RAW_ROOT, "boundaries", COMMIT[:12], resume=directory.exists())
    except SnapshotError as error:
        raise SystemExit(str(error)) from error
    for name, url in [*kabupaten_files(), *province_files()]:
        if writer.existing(name, url, lambda content: content.rstrip().endswith(b";")) is None:
            print(f"fetch {name}")
            writer.add(name, url, fetcher.get(url))
    writer.seal()
    return read_snapshot(directory)[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Build simplified map outlines for apps/web.")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    contents = snapshot(PoliteFetcher(delay_seconds=0.25, max_bytes=20 * 1024 * 1024))
    regions = {}
    provinces = {}
    for name, content in contents.items():
        text = content.decode("utf-8")
        if name.startswith("kab_"):
            regions.update(parse(text, REGION_CODE))
        else:
            provinces.update(parse(text, PROVINCE_CODE))

    # Every Kemendagri kab/kota and province must have an outline, and nothing extra may appear.
    reference = normalize(extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8"))
    expected_regions = {r.code for r in reference.regions}
    expected_provinces = {p.code for p in reference.provinces}
    problems = []
    if set(regions) != expected_regions:
        problems.append(
            f"regions missing={sorted(expected_regions - set(regions))[:10]} extra={sorted(set(regions) - expected_regions)[:10]}"
        )
    if set(provinces) != expected_provinces:
        problems.append(
            f"provinces missing={sorted(expected_provinces - set(provinces))} extra={sorted(set(provinces) - expected_provinces)}"
        )
    if problems:
        print("Boundary coverage check failed: " + "; ".join(problems), file=sys.stderr)
        return 1

    output = build_map(regions, provinces)
    output["source"] = {
        "repository": "https://github.com/cahyadsn/wilayah_boundaries",
        "commit": COMMIT,
        "license": "MIT",
        "codes": "Kepmendagri No. 300.2.2-2430 Tahun 2025",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.output, output, compact=True)
    print(
        json.dumps(
            {"regions": len(output["regions"]), "provinces": len(output["provinces"]), "bytes": args.output.stat().st_size}
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
