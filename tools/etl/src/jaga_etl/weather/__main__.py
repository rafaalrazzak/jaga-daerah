"""Build the web weather/climate file from BMKG monthly normal rainfall (1981–2010).

Two modes, like the other ETL commands:

    uv run python -m jaga_etl.weather --snapshot data/raw/bmkg-weather/<id> \\
        --output ../../apps/web/src/data/weather.json      # offline rebuild, no network
    uv run python -m jaga_etl.weather --output ...          # fetch a new sealed snapshot, then build

`--propose-points` regenerates `reference/weather-sample-points.csv` from the sealed boundary
snapshot; the file is reviewed data, so review the diff before committing it.

Quality gate (blocking): every Kemendagri kabupaten/kota must have exactly one reviewed sample point
that lies inside its own boundary, and the sealed snapshot must carry all twelve monthly values for
that point. A missing region, a duplicated point, a point outside its region, or a `NoData` month
fails the run and no file is written.
"""

import argparse
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.boundaries.build import parse
from jaga_etl.boundaries.source import COMMIT as BOUNDARY_COMMIT
from jaga_etl.boundaries.source import kabupaten_files
from jaga_etl.http import PoliteFetcher
from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import normalize
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import Manifest, SnapshotWriter, read_snapshot
from jaga_etl.weather import source as weather_source
from jaga_etl.weather.build import (
    FILE_TEMPLATE,
    QualityGateError,
    SamplePoint,
    build_records,
    candidate_points,
    check_points,
    check_snapshot_urls,
    parse_identify,
    propose_points,
    read_reference,
    write_reference,
)
from jaga_etl.weather.source import MONTH_LAYERS
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REFERENCE = ETL_ROOT / "reference" / "weather-sample-points.csv"
REPORT_DIRECTORY = ETL_ROOT / "reports"
BOUNDARY_RAW = RAW_ROOT / "boundaries" / BOUNDARY_COMMIT[:12]
REGION_CODE = re.compile(r"\d{2}\.\d{2}")
# How many interior points a region with an unusable reviewed point may be retried on, capped so a
# poorly covered region cannot multiply requests: the portal is a public service, not a bulk API.
MAX_ATTEMPTS = 5


def expected_codes() -> set[str]:
    """The Kemendagri kabupaten/kota the site publishes, from the validated region reference."""
    data = normalize(extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8"))
    return {region.code for region in data.regions}


def boundary_regions():
    """Regions from the sealed boundary snapshot, so the gate can test a point against its shape."""
    contents = read_snapshot(BOUNDARY_RAW)[1]
    regions = {}
    for name, _ in kabupaten_files():
        regions.update(parse(contents[name].decode("utf-8"), REGION_CODE))
    return regions


def _looks_like_identify(content: bytes) -> bool:
    try:
        payload = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    return isinstance(payload, dict) and ("results" in payload or "error" in payload)


def _usable(content: bytes) -> bool:
    """True when the response carries a usable value for every month.

    A cell outside BMKG's coverage reports `NoData`. Two Sumbawa cells instead report physically
    impossible NEGATIVE normal rainfall (52.04 Kabupaten Sumbawa: Agustus; 52.05 Kabupaten Dompu:
    Agustus and September, in the 17 October 2026 snapshot), an artefact of the raster being blended
    over the coast. Negative months are never published as a figure; the build records those regions
    as unavailable.
    """
    try:
        layers = parse_identify(content)
    except (ValueError, json.JSONDecodeError):
        return False
    return all(
        (value := layers.get(layer)) is not None and value >= 0 for layer in MONTH_LAYERS
    )


def fetch(points: dict[str, SamplePoint], resume: str | None) -> Path:
    """Download one `identify` response per region into a sealed, resumable snapshot.

    The reviewed point is asked first. A cell BMKG does not cover (`NoData`) is retried on a few
    interior candidates; when one works, the reference file is rewritten to that point, so the
    published coordinate, the recorded one and the URL in the manifest always agree. When no
    candidate works, the response for the ORIGINAL reviewed point is stored — never the last failed
    attempt's — and the build publishes that region as unavailable rather than as zero.
    """
    writer = SnapshotWriter(RAW_ROOT, "bmkg-weather", resume, resume=resume is not None)
    fetcher = PoliteFetcher(delay_seconds=weather_source.REQUEST_DELAY_SECONDS, max_bytes=1024 * 1024)
    regions = boundary_regions()
    updated = dict(points)
    for index, code in enumerate(sorted(points), start=1):
        name = FILE_TEMPLATE.format(code=code)
        reviewed = points[code]
        first_url = weather_source.identify_url(reviewed.latitude, reviewed.longitude)
        # `existing` adopts a response an interrupted run already completed: one region is one
        # request, so resuming never re-asks the portal for a region it already answered for.
        if writer.existing(name, first_url, _looks_like_identify) is not None:
            continue

        first = (reviewed.latitude, reviewed.longitude)
        interiors = [point for point, _ in candidate_points(regions[code])] if code in regions else []
        attempts = [first, *[point for point in interiors if point != first]][:MAX_ATTEMPTS]
        print(f"fetch {index}/{len(points)} {code}", flush=True)
        first_content: bytes | None = None
        for order, (raw_latitude, raw_longitude) in enumerate(attempts):
            # Round before use so the requested URL, the recorded reference point and the manifest
            # entry are the same coordinate: the gate re-derives the URL from the reference file and
            # fails the build if they ever disagree.
            latitude, longitude = round(raw_latitude, 6), round(raw_longitude, 6)
            content = fetcher.get(weather_source.identify_url(latitude, longitude))
            if order == 0:
                first_content = content
            if _usable(content):
                writer.add(name, weather_source.identify_url(latitude, longitude), content)
                if order > 0:
                    updated[code] = SamplePoint(
                        code=code,
                        latitude=latitude,
                        longitude=longitude,
                        method="interior",
                        note="titik pertama yang masih memiliki nilai normal (titik awal tidak terpakai)",
                    )
                break
        else:
            # Nothing worked: keep the region at its reviewed point so the stored response and the
            # reference file still describe the same coordinate.
            writer.add(name, first_url, first_content if first_content is not None else b"{}")
    writer.seal()
    if updated != points:
        write_reference(REFERENCE, updated)
    return writer.directory


def build(
    points: dict[str, SamplePoint],
    contents: dict[str, bytes],
    expected: set[str],
    manifest: Manifest,
    output: Path | None,
) -> dict[str, object]:
    """Run the blocking gate, then write the published file when an output path is given."""
    problems = check_points(points, boundary_regions(), expected)
    problems += check_snapshot_urls(points, manifest, expected)
    if problems:
        raise QualityGateError(problems)
    records, unavailable, problems = build_records(points, contents, expected)
    if problems:
        raise QualityGateError(problems)
    if output is not None:
        write_json(
            output,
            {
                "source": {
                    "publisher": weather_source.PUBLISHER,
                    "title": weather_source.TITLE,
                    "url": weather_source.SERVICE_URL,
                    "portal_url": weather_source.PORTAL_URL,
                    "license": weather_source.LICENSE,
                    "license_url": weather_source.LICENSE_URL,
                    "attribution": weather_source.ATTRIBUTION,
                    "period_start": weather_source.PERIOD_START,
                    "period_end": weather_source.PERIOD_END,
                    "captured_at": manifest.created_at,
                    "snapshot_checksum": manifest.checksum,
                },
                "regions": records,
                "unavailable": unavailable,
            },
        )
    annual = [record["annual_mm"] for record in records.values()]
    return {
        "rows": len(records),
        "unavailable_regions": sorted(unavailable),
        "annual_mm_min": min(annual),
        "annual_mm_max": max(annual),
        "snapshot_checksum": manifest.checksum,
        "captured_at": manifest.created_at,
    }


def write_report(report: dict[str, object]) -> Path:
    REPORT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIRECTORY / f"weather-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}.json"
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the BMKG normal-rainfall climatology module.")
    parser.add_argument("--output", type=Path, help="write the web data file here")
    parser.add_argument("--snapshot", type=Path, help="rebuild offline from a sealed snapshot directory")
    parser.add_argument("--reference", type=Path, default=REFERENCE, help="reviewed sample points CSV")
    parser.add_argument("--resume", help="continue an interrupted snapshot with this id")
    parser.add_argument(
        "--propose-points",
        action="store_true",
        help="regenerate the sample-point CSV from the boundary snapshot and exit (for review)",
    )
    args = parser.parse_args()

    if args.propose_points:
        proposed = propose_points(boundary_regions())
        missing = sorted(expected_codes() - set(proposed))
        if missing:
            print(f"No candidate sample point for {len(missing)} region(s): {missing[:8]}", file=sys.stderr)
            return 1
        write_reference(args.reference, proposed)
        print(f"Wrote {len(proposed)} proposed sample points to {args.reference}; review before use.")
        return 0

    points = read_reference(args.reference)
    if args.snapshot is not None:
        manifest, contents = read_snapshot(args.snapshot)
    else:
        # A fetch only seals raw responses; publishing is a separate, reviewed run over that snapshot.
        directory = fetch(points, args.resume)
        print(f"Sealed snapshot: {directory.relative_to(ETL_ROOT)}")
        print("Re-run with --snapshot for that directory to run the quality gate and publish.")
        return 0

    report: dict[str, object] = {
        "generated_at": datetime.now(UTC).isoformat(),
        "regions_expected": len(points),
        "snapshot": manifest.checksum,
        "quality_gate": "passed",
    }  # fmt: skip
    try:
        report.update(build(points, contents, expected_codes(), manifest, args.output))
    except QualityGateError as error:
        report["quality_gate"] = "failed"
        report["problems"] = error.problems
        path = write_report(report)
        print(str(error), file=sys.stderr)
        print(f"Report: {path}")
        return 1

    path = write_report(report)
    print(json.dumps({k: v for k, v in report.items() if k != "generated_at"}, ensure_ascii=False))
    print(f"Report: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
