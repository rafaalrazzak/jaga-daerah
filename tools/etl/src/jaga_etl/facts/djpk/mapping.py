"""Map DJPK pemda names to Kemendagri region codes, with an auditable trail.

DJPK publishes its own codes, so matching is by name within the matched province. Every match
records how it was made: `exact` (normalized names equal) or `alias` (a reviewed row in
reference/djpk-aliases.csv). Anything else is unmatched and blocks publication until reviewed.
"""

import csv
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

MatchMethod = Literal["exact", "alias"]


@dataclass(frozen=True)
class KemendagriRegion:
    code: str
    name: str
    province_code: str


@dataclass(frozen=True)
class KemendagriProvince:
    code: str
    name: str


@dataclass(frozen=True)
class Alias:
    kind: Literal["province", "region"]
    djpk_province_code: str
    djpk_name: str
    kemendagri_code: str
    note: str


@dataclass(frozen=True)
class Match:
    kemendagri_code: str
    method: MatchMethod


def name_key(name: str) -> str:
    """Case-, accent-, punctuation- and spacing-insensitive key ("Kab. Bau-Bau" == "Kabupaten Baubau")."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    ascii_name = re.sub(r"^provinsi\s+", "", ascii_name.strip())
    ascii_name = re.sub(r"^kab\.?\s+", "kabupaten ", ascii_name)
    ascii_name = re.sub(r"\badministrasi\b", "", ascii_name)
    return re.sub(r"[^a-z0-9]", "", ascii_name)


def read_aliases(path: Path) -> list[Alias]:
    with path.open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    invalid = [row for row in rows if row["kind"] not in ("province", "region")]
    if invalid:
        raise ValueError(f"unknown alias kind in {path}: {invalid[0]}")
    return [
        Alias(
            kind="province" if row["kind"] == "province" else "region",
            djpk_province_code=row["djpk_province_code"],
            djpk_name=row["djpk_name"],
            kemendagri_code=row["kemendagri_code"],
            note=row["note"],
        )
        for row in rows
    ]


class RegionMatcher:
    def __init__(
        self,
        provinces: list[KemendagriProvince],
        regions: list[KemendagriRegion],
        aliases: list[Alias],
    ) -> None:
        self._province_by_key = {name_key(p.name): p.code for p in provinces}
        self._region_by_key: dict[tuple[str, str], str] = {
            (r.province_code, name_key(r.name)): r.code for r in regions
        }
        self._aliases = {
            (a.kind, a.djpk_province_code, name_key(a.djpk_name)): a.kemendagri_code for a in aliases
        }

    def province(self, djpk_code: str, djpk_name: str) -> Match | None:
        alias = self._aliases.get(("province", djpk_code, name_key(djpk_name)))
        if alias is not None:
            return Match(alias, "alias")
        code = self._province_by_key.get(name_key(djpk_name))
        return Match(code, "exact") if code is not None else None

    def region(self, djpk_province_code: str, province: Match, djpk_name: str) -> Match | None:
        alias = self._aliases.get(("region", djpk_province_code, name_key(djpk_name)))
        if alias is not None:
            return Match(alias, "alias")
        code = self._region_by_key.get((province.kemendagri_code, name_key(djpk_name)))
        return Match(code, "exact") if code is not None else None
