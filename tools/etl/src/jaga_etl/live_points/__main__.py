"""Build the static reference file for the live weather / warning / earthquake / hotspot endpoint.

Usage (from tools/etl), fully offline over files already on disk:
    uv run python -m jaga_etl.live_points --output ../../apps/api/src/data/live-points.json

Inputs: the pinned wilayah dump (checksum verified, never downloaded here), the reviewed
`reference/weather-sample-points.csv`, the sealed boundary snapshot, and `apps/web/src/data/regions.json`
(the authoritative slug list). See `build.py` for the adm4 and bbox rules and the quality gate.
The gate also requires exactly `EXPECTED_REGIONS` records; on any failure nothing is written.
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

from jaga_etl.boundaries.build import parse
from jaga_etl.boundaries.source import COMMIT as BOUNDARY_COMMIT
from jaga_etl.boundaries.source import kabupaten_files
from jaga_etl.live_points.build import QualityGateError, build_regions, parse_subdivisions
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import SnapshotError, read_snapshot
from jaga_etl.weather.build import read_reference
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
REPOSITORY_ROOT = ETL_ROOT.parents[1]
RAW_ROOT = ETL_ROOT / "data" / "raw"
WILAYAH = RAW_ROOT / f"wilayah-{REGION_CODE_SOURCE.commit[:12]}.sql"
BOUNDARIES = RAW_ROOT / "boundaries" / BOUNDARY_COMMIT[:12]
POINTS = ETL_ROOT / "reference" / "weather-sample-points.csv"
REGIONS = REPOSITORY_ROOT / "apps" / "web" / "src" / "data" / "regions.json"
REGION_CODE = re.compile(r"\d{2}\.\d{2}")
# Kepmendagri 300.2.2-2430/2025: 416 kabupaten + 98 kota.
EXPECTED_REGIONS = 514


def read_wilayah(path: Path) -> str:
    """The pinned dump, refused unless its SHA-256 equals the pinned one (no download fallback)."""
    content = path.read_bytes()
    digest = hashlib.sha256(content).hexdigest()
    if digest != REGION_CODE_SOURCE.sha256:
        raise SystemExit(f"{path} has SHA-256 {digest}, expected pinned {REGION_CODE_SOURCE.sha256}.")
    return content.decode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build live-points.json for the API Worker.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--wilayah", type=Path, default=WILAYAH, help="pinned wilayah SQL dump")
    parser.add_argument("--boundaries", type=Path, default=BOUNDARIES, help="sealed boundary snapshot")
    parser.add_argument("--points", type=Path, default=POINTS, help="reviewed sample points CSV")
    parser.add_argument("--regions", type=Path, default=REGIONS, help="web regions.json (slug list)")
    args = parser.parse_args()

    subdivisions = parse_subdivisions(read_wilayah(args.wilayah))
    try:
        contents = read_snapshot(args.boundaries)[1]
    except SnapshotError as error:
        raise SystemExit(str(error)) from error
    boundaries = {}
    for name, _ in kabupaten_files():
        boundaries.update(parse(contents[name].decode("utf-8"), REGION_CODE))
    reference = json.loads(args.regions.read_text(encoding="utf-8"))

    try:
        if len(reference) != EXPECTED_REGIONS:
            raise QualityGateError([f"regions.json has {len(reference)} regions, expected {EXPECTED_REGIONS}"])
        regions = build_regions(reference, subdivisions, read_reference(args.points), boundaries)
        if len(regions) != EXPECTED_REGIONS:
            raise QualityGateError([f"built {len(regions)} regions, expected {EXPECTED_REGIONS}"])
    except QualityGateError as error:
        print(str(error), file=sys.stderr)
        for problem in error.problems:
            print(f"  {problem}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json(
        args.output,
        {
            "source": {
                "wilayah_commit": REGION_CODE_SOURCE.commit,
                "wilayah_sha256": REGION_CODE_SOURCE.sha256,
                "boundaries_commit": BOUNDARY_COMMIT,
                "generated_by": "jaga_etl.live_points",
            },
            "regions": regions,
        },
    )
    kecamatan = sum(len(record["kecamatan_list"]) for record in regions.values())
    print(json.dumps({"regions": len(regions), "kecamatan": kecamatan, "bytes": args.output.stat().st_size}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
