"""Fetch KPU Pilkada 2024 candidate pairs and export them for the web.

Usage (from tools/etl):
    uv run python -m jaga_etl.officials --output ../../apps/web/src/data/candidates.json
    uv run python -m jaga_etl.officials --snapshot data/raw/kpu/<id> --output ...   # rebuild offline
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key
from jaga_etl.http import PoliteFetcher
from jaga_etl.officials.parse import (
    CandidatePair,
    Person,
    parse_candidates,
    parse_regions,
    read_aliases,
    read_winners,
    region_index,
)
from jaga_etl.officials.source import CANDIDATES_URL, ELECTIONS, PORTAL, REGIONS_URL, candidates_file, regions_file
from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import normalize
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import Manifest, SnapshotWriter, read_snapshot
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REFERENCE = ETL_ROOT / "reference"
# DKI Jakarta's kabupaten/kota are administrative: no regional head election.
NON_AUTONOMOUS_PROVINCES = frozenset({"31"})


def fetch(fetcher: PoliteFetcher, workers: int, resume: str | None) -> tuple[Manifest, dict[str, bytes]]:
    writer = SnapshotWriter(RAW_ROOT, "kpu", resume, resume=resume is not None)
    regions = []
    for election in ELECTIONS:
        url = f"{REGIONS_URL}#jenis_pemilihan={election}"
        content = writer.existing(regions_file(election), url, lambda body: body.lstrip().startswith(b"["))
        if content is None:
            content = fetcher.post_form(REGIONS_URL, {"jenis_pemilihan": election})
            writer.add(regions_file(election), url, content)
        regions.extend(parse_regions(content, election))

    def download(region) -> None:
        name, url = candidates_file(region.election, region.name), f"{CANDIDATES_URL}#{region.name}"
        # An empty page is a valid answer (e.g. DKI's administrative Kepulauan Seribu has no election).
        if writer.existing(name, url, lambda _: True) is not None:
            return
        writer.add(name, url, fetcher.post_form(CANDIDATES_URL, {"id_wilayah": region.region_id}))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(download, regions))
    manifest = writer.seal()
    return manifest, read_snapshot(writer.directory)[1]


def _pair(pair: CandidatePair) -> dict[str, object]:
    def person(value: Person) -> dict[str, object]:
        return {"name": value.name, "last_education": value.last_education, "occupations": list(value.occupations)}

    return {
        "number": pair.number,
        "head": person(pair.head),
        "deputy": person(pair.deputy),
        "parties": list(pair.parties),
        "vision": pair.vision,
        "elected_source": None,
    }


ELECTION_LABELS = {"Bupati": "Pemilihan Bupati", "Walikota": "Pemilihan Wali Kota", "Gubernur": "Pemilihan Gubernur"}
# DI Yogyakarta's governor is not elected (Law 13/2012), so it has no Pilkada Gubernur.
PROVINCES_WITHOUT_ELECTION = frozenset({"34"})


def build(manifest: Manifest, contents: dict[str, bytes]) -> tuple[dict[str, object], list[str]]:
    reference = normalize(extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8"))
    autonomous = {r.code for r in reference.regions if r.province_code not in NON_AUTONOMOUS_PROVINCES}
    regions_by_key = region_index([(r.code, r.name) for r in reference.regions])
    provinces_by_key = region_index([(p.code, p.name) for p in reference.provinces])
    aliases = read_aliases(REFERENCE / "kpu-aliases.csv")
    winners = read_winners(REFERENCE / "pilkada-winners.csv")

    errors: list[str] = []
    output: dict[str, dict[str, dict[str, object]]] = {"regions": {}, "provinces": {}}
    for election in ELECTIONS:
        level = "provinces" if election == "Gubernur" else "regions"
        index = provinces_by_key if level == "provinces" else regions_by_key
        for region in parse_regions(contents[regions_file(election)], election):
            key = name_key(region.name)
            code = aliases.get(key) or index.get(key)
            if code is None:
                errors.append(f"unmatched KPU region: {election} {region.name}")
                continue
            if code in output[level]:
                errors.append(f"two KPU regions map to {code}: {region.name}")
                continue
            try:
                pairs = parse_candidates(contents[candidates_file(election, region.name)])
            except (KeyError, ValueError) as error:
                errors.append(f"{region.name}: {error}")
                continue
            if not pairs:
                if level == "regions" and code in autonomous:
                    errors.append(f"{region.name}: no candidate pairs")
                continue
            output[level][code] = {"election": ELECTION_LABELS[election], "pairs": [_pair(p) for p in pairs]}

    missing = sorted(autonomous - set(output["regions"]))
    errors.extend(f"no KPU candidates for autonomous region {code}" for code in missing)
    expected_provinces = {p.code for p in reference.provinces} - PROVINCES_WITHOUT_ELECTION
    errors.extend(
        f"no KPU governor candidates for province {code}"
        for code in sorted(expected_provinces - set(output["provinces"]))
    )
    for winner in winners:
        level = "provinces" if "." not in winner.region_code else "regions"
        pairs = output[level].get(winner.region_code, {}).get("pairs", [])
        match = [p for p in pairs if p["number"] == winner.number]
        if not match:
            errors.append(f"winner row does not match a pair: {winner}")
            continue
        match[0]["elected_source"] = winner.source_url

    return {
        "source": {
            "publisher": "KPU",
            "title": "Info Pemilu — Pasangan Calon Pilkada 2024",
            "url": PORTAL,
            "downloaded_at": manifest.created_at,
            "checksum_sha256": manifest.checksum,
        },
        "regions": dict(sorted(output["regions"].items())),
        "provinces": dict(sorted(output["provinces"].items())),
    }, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="KPU Pilkada 2024 candidate pairs for apps/web.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, help="rebuild from a sealed snapshot without network access")
    parser.add_argument("--workers", type=int, default=2, choices=range(1, 9), metavar="1-8")
    parser.add_argument("--resume", metavar="SNAPSHOT_ID", help="continue an interrupted KPU snapshot")
    args = parser.parse_args()

    if args.snapshot is None:
        manifest, contents = fetch(PoliteFetcher(delay_seconds=1.0), args.workers, args.resume)
    else:
        manifest, contents = read_snapshot(args.snapshot)
    output, errors = build(manifest, contents)
    if errors:
        print("KPU quality gate failed:\n  " + "\n  ".join(errors[:40]), file=sys.stderr)
        return 1
    write_json(args.output, output)
    regions = output["regions"]
    print(json.dumps({"regions": len(regions), "provinces": len(output["provinces"]), "pairs": sum(len(r["pairs"]) for r in regions.values())}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
