"""Build the list of regional heads currently in office for apps/web.

Sources: English Wikipedia "List of incumbent regional heads and deputy regional heads in <province>"
(38 pages, revision ids recorded) and Wikimedia Commons for freely licensed photos. Every person is
cross-checked against the official KPU Pilkada 2024 candidate list; a mismatch is published as
"not verified with KPU", never hidden or silently trusted. Reviewed corrections live in
`reference/incumbent-overrides.csv` and are published with the official source that justifies them
(see `_apply_overrides`).

Usage (from tools/etl, after jaga_etl.officials has written candidates.json):
    uv run python -m jaga_etl.incumbents --candidates ../../apps/web/src/data/candidates.json \
        --output ../../apps/web/src/data/officials.json
"""

import argparse
import json
import re
import sys
import urllib.parse
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key
from jaga_etl.http import PoliteFetcher
from jaga_etl.incumbents.mapping import PROVINCE_CODES, match_region, party_name, similarity
from jaga_etl.incumbents.wikitext import WikiPerson, parse_row, table_rows
from jaga_etl.regions.extract import extract
from jaga_etl.regions.normalize import normalize
from jaga_etl.regions.source import REGION_CODE_SOURCE
from jaga_etl.snapshot import Manifest, SnapshotWriter, read_snapshot
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = ETL_ROOT / "data" / "raw"
REFERENCE = ETL_ROOT / "reference"
WIKI_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
PAGE_TITLE = "List of incumbent regional heads and deputy regional heads in {province}"
PHOTO_WIDTH = 240
MATCH_THRESHOLD = 0.8
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    start=1,
)}  # fmt: skip


def _iso(date: str | None) -> str | None:
    if date is None:
        return None
    day, month, year = date.split()
    return f"{year}-{MONTHS[month]:02d}-{int(day):02d}"


def _pages_url(titles: list[str]) -> str:
    # One request for all 38 pages (the API takes up to 50 titles), to stay well within rate limits.
    return f"{WIKI_API}?" + urllib.parse.urlencode(
        {"action": "query", "prop": "revisions", "rvprop": "ids|timestamp|content", "rvslots": "main",
         "titles": "|".join(titles), "format": "json", "formatversion": "2"}  # fmt: skip
    )


def _commons_url(files: list[str]) -> str:
    return f"{COMMONS_API}?" + urllib.parse.urlencode(
        {"action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": str(PHOTO_WIDTH),
         "titles": "|".join(f"File:{name}" for name in files), "format": "json", "formatversion": "2"}  # fmt: skip
    )


def fetch(fetcher: PoliteFetcher, resume: str | None) -> Path:
    writer = SnapshotWriter(RAW_ROOT, "wikipedia", resume, resume=resume is not None)
    photos: list[str] = []
    url = _pages_url([PAGE_TITLE.format(province=province) for province in PROVINCE_CODES])
    content = writer.existing("pages.json", url, _is_json)
    if content is None:
        content = fetcher.get(url)
        writer.add("pages.json", url, content)
    for page in _pages(content).values():
        for row in table_rows(page["revisions"][0]["slots"]["main"]["content"]):
            parsed = parse_row(row)
            for person in (parsed.head, parsed.deputy) if parsed else ():
                if person is not None and person.photo_file:
                    photos.append(person.photo_file)
    unique = sorted(set(photos))
    for index in range(0, len(unique), 50):
        batch = unique[index : index + 50]
        name, batch_url = f"commons-{index // 50:03d}.json", _commons_url(batch)
        if writer.existing(name, batch_url, _is_json) is None:
            writer.add(name, batch_url, fetcher.get(batch_url))
    writer.seal()
    return writer.directory


def _is_json(content: bytes) -> bool:
    try:
        json.loads(content)
    except ValueError:
        return False
    return True


def _pages(content: bytes) -> dict[str, dict]:
    """Title → page object; every expected province page must exist."""
    pages = {page["title"]: page for page in json.loads(content)["query"]["pages"]}
    missing = [title for title, page in pages.items() if page.get("missing")]
    if missing:
        raise ValueError(f"missing Wikipedia pages {missing}")
    return pages


def _revision(page: dict) -> dict[str, object]:
    revision = page["revisions"][0]
    return {
        "title": page["title"],
        "revision_id": revision["revid"],
        "timestamp": revision["timestamp"],
        "url": f"https://en.wikipedia.org/w/index.php?oldid={revision['revid']}",
    }


def _photos(contents: dict[str, bytes]) -> dict[str, dict[str, str]]:
    """File name → thumbnail and licence; only files hosted on Commons (free licences) qualify."""
    photos: dict[str, dict[str, str]] = {}
    for name, content in contents.items():
        if not name.startswith("commons-"):
            continue
        for page in json.loads(content)["query"].get("pages", []):
            info = (page.get("imageinfo") or [None])[0]
            if page.get("missing") or info is None:
                continue
            meta = info.get("extmetadata", {})
            licence = meta.get("LicenseShortName", {}).get("value")
            if not licence or meta.get("NonFree", {}).get("value") in ("true", True):
                continue
            artist = re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", "")).strip()
            photos[page["title"].removeprefix("File:")] = {
                "url": info["thumburl"],
                "page": info["descriptionurl"],
                "license": licence,
                "artist": re.sub(r"\s+", " ", artist)[:120] or "Tidak disebutkan",
            }
    return photos


def _read_aliases(path: Path) -> dict[str, str]:
    import csv

    with path.open(encoding="utf-8", newline="") as file:
        return {name_key(row["wikipedia_name"]): row["kemendagri_code"] for row in csv.DictReader(file)}


# Reviewed corrections where the Wikipedia row is stale or contradicts the official page. Each row
# carries the official source URL; the CSV is the only place a value may be replaced, never the code.
OVERRIDE_FIELDS = {"head_name", "head_party", "deputy_name", "deputy_party", "since", "until"}


@dataclass(frozen=True)
class Override:
    """One reviewed correction, in CSV order: the replaced field plus the source that justifies it."""

    code: str
    field: str
    value: str
    source_url: str
    note: str


def _read_overrides(path: Path) -> list[Override]:
    import csv

    with path.open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    unknown = sorted({row["field"] for row in rows} - OVERRIDE_FIELDS)
    if unknown:
        raise ValueError(f"unknown override fields {unknown} in {path.name}")
    # The published record requires the official URL and the reviewer's reason (see
    # packages/contracts/src/officials.ts); refuse a row that would ship without them.
    incomplete = [row for row in rows if not row["source_url"].strip() or not row["note"].strip()]
    if incomplete:
        raise ValueError(f"override rows without source_url or note in {path.name}: {incomplete}")
    return [
        Override(row["kemendagri_code"], row["field"], row["value"], row["source_url"], row["note"])
        for row in rows
    ]


def _apply_overrides(regions: dict[str, dict[str, object]], overrides: list[Override]) -> None:
    """Replace reviewed values and record where each replacement came from.

    `page` keeps the Wikipedia revision the base row came from; `corrections` names the corrected
    field with its official source and note, so the profile attributes the replaced values to the
    official page instead of implying the cited revision states them.
    """
    for override in overrides:
        code, field = override.code, override.field
        region = regions.get(code)
        if region is None:
            raise ValueError(f"override for unknown region {code}")
        if field in ("since", "until"):
            region[field] = override.value or None
        else:
            role, attribute = field.split("_", 1)
            person = region[role]
            if person is None:
                raise ValueError(f"override {field} for {code} has no {role}")
            if attribute == "name":
                person["photo"] = None  # the row's photo depicts the replaced person, not the office
            person[attribute] = override.value or None
        region["corrections"].append(
            {"field": field, "source_url": override.source_url, "note": override.note}
        )


def _kpu_match(name: str, election: dict[str, object] | None, role: str) -> dict[str, object] | None:
    """Best-scoring KPU candidate in the same region; below the threshold the person stays unverified.

    Only candidates at or above the threshold are eligible, and the person's own office (head/deputy)
    is preferred over the other slot before the score: without that, a rival pair's deputy whose name
    merely contains the head's surname ("MIRWAN, S.H.") outscores the head's own KPU entry
    ("H. MIRWAN MS, S.E., M.Sos."). Ties fall back to the highest score, then the lowest pair index.
    """
    if election is None:
        return None
    scored = [
        (similarity(name, pair[slot]["name"]), index, slot)
        for index, pair in enumerate(election["pairs"])
        for slot in ("head", "deputy")
    ]
    eligible = [entry for entry in scored if entry[0] >= MATCH_THRESHOLD]
    if not eligible:
        return None
    _, index, matched = min(eligible, key=lambda entry: (entry[2] != role, -entry[0], entry[1]))
    return {"pair_index": index, "role": matched}


def build(snapshot: Manifest, contents: dict[str, bytes], candidates: dict[str, object]) -> tuple[dict[str, object], list[str]]:
    reference = normalize(extract(REGION_CODE_SOURCE, RAW_ROOT).path.read_text(encoding="utf-8"))
    aliases = _read_aliases(REFERENCE / "wikipedia-aliases.csv")
    overrides = _read_overrides(REFERENCE / "incumbent-overrides.csv")
    photos = _photos(contents)
    errors: list[str] = []
    regions: dict[str, dict[str, object]] = {}
    revisions = []

    pages = _pages(contents["pages.json"])
    for province, code in PROVINCE_CODES.items():
        page = pages.get(PAGE_TITLE.format(province=province))
        if page is None:
            errors.append(f"no Wikipedia page for {province}")
            continue
        revisions.append(_revision(page))
        index = {name_key(r.name): r.code for r in reference.regions if r.province_code == code}
        for row in table_rows(page["revisions"][0]["slots"]["main"]["content"]):
            parsed = parse_row(row)
            if parsed is None or parsed.head is None:
                continue
            # A target without a Regency/City suffix ("Bandung") is ambiguous; use the display text then.
            suffixed = re.search(r"(Regency|City)$", parsed.region_target) is not None
            names = [parsed.region_target, parsed.region] if suffixed else [parsed.region]
            region_code = match_region(names, index, aliases)
            if region_code is None:
                errors.append(f"unmatched Wikipedia region in {province}: {parsed.region}")
                continue
            if region_code in regions:
                errors.append(f"two rows map to {region_code}: {parsed.region}")
                continue

            def person(value: WikiPerson | None) -> dict[str, object] | None:
                if value is None:
                    return None
                return {
                    "name": value.name,
                    "party": party_name(value.party),
                    "acting": value.acting,
                    "photo": photos.get(value.photo_file) if value.photo_file else None,
                    "kpu": None,
                }

            regions[region_code] = {
                "head": person(parsed.head),
                "deputy": person(parsed.deputy),
                "since": _iso(parsed.since),
                "until": _iso(parsed.until),
                "page": revisions[-1]["url"],
                # Filled by _apply_overrides for reviewed regions, empty for every other row.
                "corrections": [],
            }

    _apply_overrides(regions, overrides)
    for code, region in regions.items():
        election = candidates["regions"].get(code)
        for role in ("head", "deputy"):
            if region[role] is not None:
                region[role]["kpu"] = _kpu_match(region[role]["name"], election, role)

    missing = sorted({r.code for r in reference.regions} - set(regions))
    errors.extend(f"no incumbent row for region {code}" for code in missing)
    errors.extend(
        f"{code}: until {region['until']} precedes since {region['since']}"
        for code, region in sorted(regions.items())
        if region["since"] and region["until"] and region["until"] < region["since"]
    )  # fmt: skip
    return {
        "source": {
            "publisher": "Wikipedia (dicocokkan dengan daftar calon KPU)",
            "license": "CC BY-SA 4.0 (teks); foto sesuai lisensi masing-masing di Wikimedia Commons",
            "downloaded_at": snapshot.created_at,
            "checksum_sha256": snapshot.checksum,
            "pages": revisions,
        },
        "regions": dict(sorted(regions.items())),
    }, errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Regional heads in office, for apps/web.")
    parser.add_argument("--candidates", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, help="rebuild from a sealed snapshot without network access")
    parser.add_argument("--resume", metavar="SNAPSHOT_ID", help="continue an interrupted Wikipedia snapshot")
    args = parser.parse_args()

    # Wikimedia throttles anonymous tools: one request every 10 s, Retry-After honoured.
    directory = args.snapshot or fetch(PoliteFetcher(delay_seconds=10.0, max_bytes=20 * 1024 * 1024), args.resume)
    manifest, contents = read_snapshot(directory)
    output, errors = build(manifest, contents, json.loads(args.candidates.read_text(encoding="utf-8")))
    if errors:
        print("Incumbent quality gate failed:\n  " + "\n  ".join(errors[:60]), file=sys.stderr)
        print(f"snapshot: {directory}", file=sys.stderr)
        return 1
    write_json(args.output, output)
    people = [p for r in output["regions"].values() for p in (r["head"], r["deputy"]) if p]
    print(json.dumps({
        "regions": len(output["regions"]),
        "people": len(people),
        "kpu_verified": sum(p["kpu"] is not None for p in people),
        "with_photo": sum(p["photo"] is not None for p in people),
        "acting": sum(p["acting"] for p in people),
        "built_at": datetime.now(UTC).isoformat(),
    }))  # fmt: skip
    return 0


if __name__ == "__main__":
    sys.exit(main())
