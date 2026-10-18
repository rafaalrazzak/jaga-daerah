"""Build one kecamatan map file per kabupaten/kota for apps/web.

Usage (from tools/etl):
    uv run python -m jaga_etl.kecamatan_maps --output ../../apps/web/public/data/kecamatan
    uv run python -m jaga_etl.kecamatan_maps --output <dir> --snapshot data/raw/boundaries-kec/<id>  # offline

Without `--snapshot`, the pinned kecamatan files are fetched once into a sealed snapshot
`data/raw/boundaries-kec/<commit>/` (resumable) and reused afterwards. Region outlines come from the
sealed `data/raw/boundaries/<commit>/` snapshot written by `jaga_etl.boundaries`. Nothing is written
unless the coverage gate passes for every region.
"""

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

from jaga_etl.boundaries.build import parse
from jaga_etl.boundaries.source import COMMIT, kecamatan_files
from jaga_etl.http import PoliteFetcher
from jaga_etl.kecamatan_maps.build import GateError, build_all, kecamatan_names, parse_kecamatan
from jaga_etl.regions.extract import extract
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import SnapshotError, SnapshotWriter, read_snapshot
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
DEFAULT_REGIONS = ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json"
SNAPSHOT_SOURCE = "boundaries-kec"


def fetch_snapshot(fetcher: PoliteFetcher) -> Path:
    directory = RAW_ROOT / SNAPSHOT_SOURCE / COMMIT[:12]
    if (directory / "manifest.json").exists():
        return directory
    try:
        writer = SnapshotWriter(RAW_ROOT, SNAPSHOT_SOURCE, COMMIT[:12], resume=directory.exists())
    except SnapshotError as error:
        raise SystemExit(str(error)) from error
    for name, url in kecamatan_files():
        if writer.existing(name, url, lambda content: content.rstrip().endswith(b";")) is None:
            print(f"fetch {name}")
            writer.add(name, url, fetcher.get(url))
    writer.seal()
    return directory


def main() -> int:
    parser = argparse.ArgumentParser(description="Build per-region kecamatan maps for apps/web.")
    parser.add_argument("--output", type=Path, required=True, help="directory for <regionCode>.json files")
    parser.add_argument("--snapshot", type=Path, help="sealed boundaries-kec snapshot (offline)")
    parser.add_argument("--regions", type=Path, default=DEFAULT_REGIONS, help="apps/web region list")
    args = parser.parse_args()

    directory = args.snapshot or fetch_snapshot(PoliteFetcher(delay_seconds=0.25, max_bytes=20 * 1024 * 1024))
    try:
        _, kec_contents = read_snapshot(directory)
        _, kab_contents = read_snapshot(RAW_ROOT / "boundaries" / COMMIT[:12])
    except (SnapshotError, FileNotFoundError) as error:
        print(f"Snapshot unreadable (run jaga_etl.boundaries first for outlines): {error}", file=sys.stderr)
        return 1
    expected = {name for name, _ in kecamatan_files()}
    if set(kec_contents) != expected:
        print(f"Snapshot files differ from the pinned list: {sorted(set(kec_contents) ^ expected)}", file=sys.stderr)
        return 1

    boundaries, duplicates = parse_kecamatan([kec_contents[name].decode("utf-8") for name in sorted(expected)])
    outlines = {}
    for name, content in kab_contents.items():
        if name.startswith("kab_"):
            outlines.update(parse(content.decode("utf-8"), re.compile(r"\d{2}\.\d{2}")))
    names = kecamatan_names(extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8"))
    region_codes = [region["code"] for region in json.loads(args.regions.read_text(encoding="utf-8"))]

    try:
        outputs = build_all(region_codes, names, boundaries, duplicates, outlines)
    except GateError as error:
        print("Kecamatan map gate failed:", file=sys.stderr)
        for problem in error.problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    args.output.mkdir(parents=True, exist_ok=True)
    sizes = []
    kecamatan_count = 0
    for code, payload in outputs.items():
        path = args.output / f"{code}.json"
        write_json(path, payload)
        sizes.append(path.stat().st_size)
        kecamatan_count += len(payload["kecamatan"])
    print(
        json.dumps(
            {
                "regions": len(outputs),
                "kecamatan": kecamatan_count,
                "bytes_total": sum(sizes),
                "bytes_median": int(statistics.median(sizes)),
                "bytes_max": max(sizes),
                "snapshot": directory.name,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
