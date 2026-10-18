"""Reviewed reference tables for the natural-conditions build.

Both sources address regions by the Kemendagri code, so **no name join ever happens** and no
fuzzy match exists to get wrong. The reviewed tables therefore cover only the cases the source
itself leaves ambiguous, and an ambiguity that is not listed here stops the build instead of being
resolved by a heuristic.

`reference/nature-big-editions.csv` records, for every BIG region code that the geodatabase
publishes more than once, which edition's row is used. BIG keeps the current edition alongside
stale slivers from earlier editions, and the choice is a reviewed decision rather than "take the
newest".
"""

import csv
from dataclasses import dataclass
from pathlib import Path

EDITION_NOTE_MIN_LENGTH = 20


class MappingError(Exception):
    pass


@dataclass(frozen=True)
class EditionChoice:
    region_code: str
    edition: str
    note: str


def load_big_editions(path: Path) -> dict[str, EditionChoice]:
    """Reviewed edition per region code, keyed by the Kemendagri code BIG prints."""
    with path.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    choices: dict[str, EditionChoice] = {}
    for row in rows:
        code = (row.get("region_code") or "").strip()
        edition = (row.get("edition") or "").strip()
        note = (row.get("note") or "").strip()
        if not code or not edition:
            raise MappingError(f"{path}: every row needs region_code and edition")
        if len(note) < EDITION_NOTE_MIN_LENGTH:
            raise MappingError(f"{path}: {code} needs a review note explaining the choice")
        if code in choices:
            raise MappingError(f"{path}: duplicate reviewed row for {code}")
        choices[code] = EditionChoice(code, edition, note)
    return choices
