"""Extract public candidate facts from KPU cards and map regions to Kemendagri codes.

Kept: ballot number, names, supporting parties, vision, last education, declared occupations.
Never extracted: photos, birth date/place, address, religion, gender, legal status, or any other
personal detail the cards also contain.
"""

import codecs
import csv
import html
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key

CARD_START = '<div class="col-md-4 mb-4">'
NUMBER = re.compile(r"NOMOR URUT</i></p><h1[^>]*><strong>\s*(\d{1,2})\s*</strong>", re.DOTALL)
HEAD = re.compile(r"<strong>CALON</strong>.*?<p class=\"text-center\"><strong>(.*?)</strong>", re.DOTALL)
DEPUTY = re.compile(r"<strong>WAKIL CALON</strong>.*?<p class=\"text-center\"><strong>(.*?)</strong>", re.DOTALL)
HEAD_MODAL = re.compile(r'data-target="#(modalCakada\d+)"')
DEPUTY_MODAL = re.compile(r'data-target="#(modalCawakeda\d+)"')
PARTIES = re.compile(r"Partai Politik</h6>(.*?)</div>", re.DOTALL)
PARTY_NAME = re.compile(r'<img[^>]*\salt="([^"]+)"')
VISION = re.compile(r'<h6 class="mb-1 text-secondary">Visi</h6><p[^>]*>(.*?)</p>', re.DOTALL)
EDUCATION = re.compile(r"Pendidikan Terakhir</strong><br>(.*?)</p>", re.DOTALL)
OCCUPATIONS = re.compile(r"Riwayat Pekerjaan</strong></p><ul[^>]*>(.*?)</ul>", re.DOTALL)
LIST_ITEM = re.compile(r"<li>(.*?)</li>", re.DOTALL)
MAX_VISION = 400


def _cp1252_fallback(error: UnicodeError) -> tuple[str, int]:
    # Some cards mix UTF-8 with Windows-1252 smart quotes; decode those bytes as cp1252.
    assert isinstance(error, UnicodeDecodeError)
    return error.object[error.start : error.end].decode("cp1252", errors="replace"), error.end


codecs.register_error("jaga_cp1252", _cp1252_fallback)


@dataclass(frozen=True)
class KpuRegion:
    election: str
    name: str
    region_id: str


@dataclass(frozen=True)
class Person:
    name: str
    last_education: str | None = None
    occupations: tuple[str, ...] = ()


@dataclass(frozen=True)
class CandidatePair:
    # None when KPU prints no number (single pair against an empty box, or a re-run election).
    number: int | None
    head: Person
    deputy: Person
    parties: tuple[str, ...] = field(default=())
    vision: str | None = None


@dataclass(frozen=True)
class Winner:
    region_code: str
    number: int | None
    source_url: str


def parse_regions(content: bytes, election: str) -> list[KpuRegion]:
    payload = json.loads(content)
    if not isinstance(payload, list):
        raise ValueError("KPU region list is not an array")
    regions = []
    for item in payload:
        if not isinstance(item, dict) or item.get("pemilihan") != election:
            raise ValueError(f"unexpected KPU region entry {item!r}")
        regions.append(KpuRegion(election, str(item["nama_wilayah_baru"]).strip(), str(item["id_wilayah_encrypted"])))
    return regions


def _text(fragment: str) -> str:
    # KPU stores some smart quotes as U+FFFD already; drop those placeholders.
    text = html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("�", "")
    return re.sub(r"\s+", " ", text).strip()


def _modal(page: str, modal_id: str) -> str:
    start = page.find(f'id="{modal_id}"')
    if start == -1:
        return ""
    end = page.find('class="modal fade"', start + 1)
    return page[start : end if end != -1 else len(page)]


def _person(name: str, modal: str) -> Person:
    education = EDUCATION.search(modal)
    occupations = OCCUPATIONS.search(modal)
    items = LIST_ITEM.findall(occupations.group(1)) if occupations else []
    return Person(
        name=name,
        last_education=_text(education.group(1)) or None if education else None,
        occupations=tuple(dict.fromkeys(text for item in items if (text := _text(item)) not in ("", "-"))),
    )


def _vision(card: str) -> str | None:
    match = VISION.search(card)
    if match is None:
        return None
    text = _text(match.group(1))
    if len(text) > MAX_VISION:
        text = text[: MAX_VISION - 1].rsplit(" ", 1)[0] + "…"
    return text or None


def parse_candidates(content: bytes) -> list[CandidatePair]:
    page = content.decode("utf-8", errors="jaga_cp1252")
    cards = page.split(CARD_START)[1:]
    pairs = []
    for card in cards:
        number, head, deputy = NUMBER.search(card), HEAD.search(card), DEPUTY.search(card)
        if head is None or deputy is None:
            raise ValueError("candidate card without both names")
        head_modal, deputy_modal = HEAD_MODAL.search(card), DEPUTY_MODAL.search(card)
        parties = PARTIES.search(card)
        pair = CandidatePair(
            number=int(number.group(1)) if number else None,
            head=_person(_text(head.group(1)), _modal(page, head_modal.group(1)) if head_modal else ""),
            deputy=_person(_text(deputy.group(1)), _modal(page, deputy_modal.group(1)) if deputy_modal else ""),
            parties=tuple(dict.fromkeys(html.unescape(p).strip() for p in PARTY_NAME.findall(parties.group(1))))
            if parties
            else (),
            vision=_vision(card),
        )
        if not pair.head.name or not pair.deputy.name:
            raise ValueError(f"empty candidate name on ballot number {pair.number}")
        pairs.append(pair)
    numbers = [pair.number for pair in pairs if pair.number is not None]
    if len(set(numbers)) != len(numbers):
        raise ValueError(f"duplicate ballot numbers {numbers}")
    # Numbered pairs in ballot order; unnumbered ones keep KPU's page order (stable sort).
    return sorted(pairs, key=lambda pair: (pair.number is None, pair.number or 0))


def read_aliases(path: Path) -> dict[str, str]:
    """KPU region name → Kemendagri code for names that differ only in spelling (reviewed rows)."""
    with path.open(encoding="utf-8", newline="") as file:
        return {name_key(row["kpu_name"]): row["kemendagri_code"] for row in csv.DictReader(file)}


def read_winners(path: Path) -> list[Winner]:
    with path.open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    winners = []
    for row in rows:
        url = row["source_url"].strip()
        if not url.startswith("https://"):
            raise ValueError(f"winner row without an https source URL: {row}")
        number = row["nomor_urut"].strip()
        winners.append(Winner(row["region_code"].strip(), int(number) if number else None, url))
    return winners


def region_index(regions: list[tuple[str, str]]) -> dict[str, str]:
    """name_key → Kemendagri code; refuses ambiguous keys instead of guessing."""
    index: dict[str, str] = {}
    duplicates: set[str] = set()
    for code, name in regions:
        key = name_key(name)
        if key in index:
            duplicates.add(key)
        index[key] = code
    for key in duplicates:
        del index[key]
    return index
