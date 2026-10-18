"""Parse the Portal Data BPK CSV of LKPD opinions.

The export is one national file: a province row (blank kabupaten code) plus one row per
kabupaten/kota, with a column per LKPD year. An empty cell means BPK published no opinion for
that year, which is normal for a region that did not exist yet. It is not an opinion of its own.
"""

import csv
import re
from dataclasses import dataclass

OPINION_CODES = ("WTP", "WDP", "TW", "TMP")
YEARS = (2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024)
PROVINCE_CODE = re.compile(r"^\d{2}$")
REGION_CODE = re.compile(r"^\d{2}\.\d{2}$")


class OpinionParseError(ValueError):
    pass


@dataclass(frozen=True)
class OpinionSeries:
    code: str
    years: tuple[tuple[int, str], ...]


def parse_opinions(text: str) -> tuple[dict[str, OpinionSeries], dict[str, OpinionSeries]]:
    """Return kabupaten/kota series and province series, keyed by Kemendagri code."""
    rows = list(csv.DictReader(text.splitlines()))
    if not rows:
        raise OpinionParseError("berkas opini BPK kosong")
    missing = [name for name in ("Kode Provinsi", "Kode Kab/Kota", "Entitas", "2024") if name not in rows[0]]
    if missing:
        raise OpinionParseError(f"kolom opini BPK tidak ada: {', '.join(missing)}")

    regions: dict[str, OpinionSeries] = {}
    provinces: dict[str, OpinionSeries] = {}
    for row in rows:
        province_code = (row.get("Kode Provinsi") or "").strip()
        region_code = (row.get("Kode Kab/Kota") or "").strip()
        entity = (row.get("Entitas") or "").strip()
        if not PROVINCE_CODE.fullmatch(province_code):
            raise OpinionParseError(f"kode provinsi tidak dikenal pada {entity or province_code}")
        years = _years(row, entity or province_code)
        if region_code == "":
            _put(provinces, province_code, years, entity)
            continue
        if not REGION_CODE.fullmatch(region_code) or not region_code.startswith(f"{province_code}."):
            raise OpinionParseError(f"kode kabupaten/kota tidak cocok dengan provinsinya: {region_code}")
        _put(regions, region_code, years, entity)
    if len(provinces) != 38:
        raise OpinionParseError(f"opini provinsi berjumlah {len(provinces)}, diharapkan 38")
    return regions, provinces


def _years(row: dict[str, str | None], entity: str) -> tuple[tuple[int, str], ...]:
    found: list[tuple[int, str]] = []
    for year in YEARS:
        raw = (row.get(str(year)) or "").strip()
        if raw == "":
            continue
        if raw not in OPINION_CODES:
            raise OpinionParseError(f"opini tidak dikenal untuk {entity} {year}: {raw}")
        found.append((year, raw))
    if not found or found[-1][0] != 2024:
        raise OpinionParseError(f"{entity} tidak punya opini 2024")
    return tuple(found)


def _put(
    target: dict[str, OpinionSeries],
    code: str,
    years: tuple[tuple[int, str], ...],
    entity: str,
) -> None:
    if code in target:
        raise OpinionParseError(f"kode opini ganda: {code} ({entity})")
    target[code] = OpinionSeries(code, years)
