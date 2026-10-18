"""Build the web natural-conditions artifact from the pinned BIG and BNPB sources.

Usage (from tools/etl):
    uv run python -m jaga_etl.nature fetch
    uv run python -m jaga_etl.nature build --output ../../apps/web/src/data/nature.json
    uv run python -m jaga_etl.nature build --output <path> --snapshot data/raw/nature/<id>   # offline

`fetch` is the only step that touches the network: it writes a sealed snapshot (raw bytes plus a
`manifest.json` with URL, SHA-256, size and fetch time per file) and never overwrites an existing
one. `build` reads that snapshot, so a publication can always be reproduced from the exact bytes it
used, and `bun run format:check` stays green because the JSON goes out through
`jaga_etl.web_data.write_json`.
"""

import argparse
import json
import sys
from pathlib import Path

from jaga_etl.http import PoliteFetcher
from jaga_etl.nature.mapping import load_big_editions
from jaga_etl.nature.normalize import AREA_UNIT, Normalized, normalize
from jaga_etl.nature.source import (
    BIG_COUNT_URL,
    BIG_LICENSE,
    BIG_PUBLISHER,
    BIG_QUERY_URL,
    BIG_REUSE_NOTE,
    BIG_SOURCE_URL,
    BNPB_EVENT_LICENSE,
    BNPB_HAZARD_COLUMNS,
    BNPB_IMPACT_LICENSE,
    BNPB_IMPACTS,
    BNPB_IMPACT_METRICS,
    BNPB_PUBLISHER,
    BNPB_RESOURCES,
    dataset_url,
    datastore_url,
    resource_file_name,
)
from jaga_etl.nature.validate import check
from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import normalize as normalize_regions
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import SnapshotError, SnapshotWriter, read_snapshot
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REFERENCE = ETL_ROOT / "reference"
REPORT_DIRECTORY = ETL_ROOT / "reports"

# Human-readable descriptions of each published figure. The page shows these next to the values, so
# the copy states what a number measures and who publishes it instead of leaving a bare figure.
HAZARD_LABELS: dict[str, str] = {
    "banjir": "Banjir",
    "cuaca_ekstrem": "Cuaca ekstrem",
    "erupsi_gunung_api": "Erupsi gunung api",
    "gelombang_pasang_abrasi": "Gelombang pasang dan abrasi",
    "gempabumi": "Gempabumi",
    "kebakaran_hutan_lahan": "Kebakaran hutan dan lahan",
    "kekeringan": "Kekeringan",
    "tanah_longsor": "Tanah longsor",
    "tsunami": "Tsunami",
}

# What each impact metric counts, in the words the page shows next to the figure. The unit is the
# published unit: people or housing units, and both are counts, never rates.
IMPACT_LABELS: dict[str, str] = {
    "deaths": "Meninggal dunia",
    "missing": "Hilang",
    "injured": "Luka atau sakit",
    "affected": "Terdampak",
    "displaced": "Mengungsi",
    "houses_damaged": "Rumah rusak",
}
IMPACT_UNITS: dict[str, str] = {
    "deaths": "jiwa",
    "missing": "jiwa",
    "injured": "jiwa",
    "affected": "jiwa",
    "displaced": "jiwa",
    "houses_damaged": "unit",
}


def big_count(fetcher: PoliteFetcher) -> bytes:
    return fetcher.get(BIG_COUNT_URL)


def fetch_snapshot(fetcher: PoliteFetcher, snapshot_id: str | None) -> tuple[Path, dict[str, bytes]]:
    writer = SnapshotWriter(RAW_ROOT, "nature", snapshot_id)
    urls = [
        ("big-areas.json", BIG_QUERY_URL),
        ("big-count.json", BIG_COUNT_URL),
        *[(resource_file_name(resource), datastore_url(resource)) for resource in BNPB_RESOURCES],
    ]
    for name, url in urls:
        print(f"fetch {name}")
        writer.add(name, url, fetcher.get(url))
    manifest = writer.seal()
    print(json.dumps({"snapshot": str(writer.directory), "checksum": manifest.checksum}, indent=2))
    return writer.directory, read_snapshot(writer.directory)[1]


def load_snapshot(directory: Path) -> tuple[Path, dict[str, bytes]]:
    return directory, read_snapshot(directory)[1]


def build(normalized: Normalized, gate_coverage: dict[str, object], manifest) -> dict[str, object]:
    """Assemble the published artifact: one record per region, plus source metadata."""
    regions: dict[str, dict[str, object]] = {}

    for code, area in sorted(normalized.areas.items()):
        regions.setdefault(code, {})["area"] = {
            "value": round(area.area_km2, 3),
            "unit": AREA_UNIT,
            "edition": area.edition,
            "source_name": area.name,
        }

    by_year: dict[str, dict[str, int]] = {}
    for (code, year), record in sorted(normalized.events_by_year.items()):
        by_year.setdefault(code, {})[str(year)] = record.event_count
    for code, years in by_year.items():
        regions.setdefault(code, {})["events_by_year"] = years

    by_hazard: dict[str, dict[str, int]] = {}
    for (code, hazard), record in sorted(normalized.events_by_hazard.items()):
        by_hazard.setdefault(code, {})[hazard] = record.event_count
    for code, hazards in by_hazard.items():
        regions.setdefault(code, {})["events_by_hazard"] = hazards

    impacts: dict[str, dict[str, int]] = {}
    for (code, metric), record in sorted(normalized.impacts_by_metric.items()):
        impacts.setdefault(code, {})[metric] = record.value
    for code, metrics in impacts.items():
        regions.setdefault(code, {})["impacts_2024"] = metrics

    # Per-hazard impact, kept only where the source states a non-zero figure: a zero row adds a
    # number the reader learns nothing from, and the metric total already covers the whole region.
    impacts_by_hazard: dict[str, dict[str, int]] = {}
    for (code, hazard, metric), record in sorted(normalized.impacts_by_hazard.items()):
        if record.value == 0:
            continue
        impacts_by_hazard.setdefault(code, {})[f"{metric}.{hazard}"] = record.value
    for code, values in impacts_by_hazard.items():
        regions.setdefault(code, {})["impacts_2024_by_hazard"] = values

    return {
        "source": {
            "big": {
                "publisher": BIG_PUBLISHER,
                "title": "Batas Wilayah Administrasi Kabupaten/Kota — Luas Wilayah Menurut Peraturan",
                "url": BIG_SOURCE_URL,
                "endpoint": BIG_QUERY_URL,
                "license": BIG_LICENSE,
                "reuse_note": BIG_REUSE_NOTE,
                "unit": AREA_UNIT,
                "unit_note": (
                    "Field LUASWH diberi alias hektar oleh penerbit, tetapi nilai yang dipublikasikan "
                    "berada dalam kilometer persegi: jumlah per provinsi menghasilkan luas provinsi "
                    "resmi dalam km²."
                ),
            },
            "bnpb": {
                "publisher": BNPB_PUBLISHER,
                "title": "Kompilasi Data Kejadian dan Dampak Bencana (per kabupaten/kota)",
                "url": dataset_url(BNPB_RESOURCES[0]),
                "license": BNPB_EVENT_LICENSE,
                "impact_license": BNPB_IMPACT_LICENSE,
                "resources": [
                    {
                        "name": resource.name,
                        "resource_id": resource.resource_id,
                        "url": dataset_url(resource),
                        "license": resource.license,
                    }
                    for resource in BNPB_RESOURCES
                ],
                "hazard_labels": HAZARD_LABELS,
                "impact_labels": IMPACT_LABELS,
                "impact_units": IMPACT_UNITS,
                "note": (
                    "Angka ini adalah jumlah kejadian bencana yang tercatat, bukan indeks risiko, "
                    "bukan prediksi, dan bukan peringatan. Daerah yang tidak muncul pada sumber "
                    "tidak berarti nol kejadian."
                ),
                "impact_note": (
                    "Angka dampak adalah jumlah yang tercatat pada publikasi BNPB tahun 2024, bukan "
                    "perkiraan, bukan prediksi, dan bukan penilaian atas kinerja daerah. Angka ini "
                    "juga dipengaruhi kelengkapan pelaporan daerah."
                ),
            },
            "coverage": gate_coverage,
            "manifest_checksum": manifest.checksum,
            "downloaded_at": manifest.created_at,
        },
        "regions": regions,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build apps/web natural conditions data.")
    parser.add_argument("command", choices=("fetch", "build"))
    parser.add_argument("--output", type=Path, help="artifact path for `build`")
    parser.add_argument("--snapshot", type=Path, help="sealed snapshot directory (offline build)")
    parser.add_argument("--snapshot-id", help="snapshot id to create when fetching")
    parser.add_argument("--delay", type=float, default=1.0, help="seconds between request starts")
    args = parser.parse_args()

    if args.command == "fetch":
        directory, _ = fetch_snapshot(PoliteFetcher(delay_seconds=args.delay), args.snapshot_id)
        print(directory)
        return 0

    if args.output is None:
        parser.error("build requires --output")
    if args.snapshot is None:
        # Build from the newest sealed snapshot on disk; no network access either way.
        candidates = sorted((RAW_ROOT / "nature").glob("*/manifest.json"))
        if not candidates:
            print("No sealed nature snapshot; run `fetch` first.", file=sys.stderr)
            return 1
        directory = candidates[-1].parent
    else:
        directory = args.snapshot
    try:
        _, contents = load_snapshot(directory)
    except SnapshotError as error:
        print(str(error), file=sys.stderr)
        return 1

    reference = normalize_regions(
        extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8")
    )
    known_codes = {region.code for region in reference.regions}

    editions = load_big_editions(REFERENCE / "nature-big-editions.csv")
    # Impact metrics are addressed by their published resource id, so both the fetch list and this
    # mapping read from one table and a resource cannot be fetched without also being parsed.
    impact_resources = {resource.resource_id: resource for resource in BNPB_IMPACTS}
    normalized = normalize(
        contents["big-areas.json"],
        contents[resource_file_name(BNPB_RESOURCES[0])],
        contents[resource_file_name(BNPB_RESOURCES[1])],
        editions=editions,
        bnpb_impact_payloads={
            metric: contents[resource_file_name(impact_resources[resource_id])]
            for metric, resource_id in BNPB_IMPACT_METRICS.items()
        },
    )
    gate = check(normalized, known_codes, len(known_codes))
    coverage = gate.coverage

    report = {
        "passed": gate.passed,
        "errors": gate.errors,
        "warnings": gate.warnings,
        "coverage": coverage,
    }
    REPORT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    (REPORT_DIRECTORY / "nature-latest.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    if not gate.passed:
        print(json.dumps(report, indent=2, ensure_ascii=False), file=sys.stderr)
        return 1

    manifest, _ = read_snapshot(directory)
    payload = build(normalized, coverage, manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.output, payload)
    print(
        json.dumps(
            {
                "regions": len(payload["regions"]),
                "coverage": {
                    key: f"{value['covered']}/{value['total']}"
                    for key, value in coverage.items()
                    if isinstance(value, dict)
                },
                "warnings": gate.warnings,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
