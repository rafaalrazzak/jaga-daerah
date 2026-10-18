"""Parse the KLHK 2023 provincial land-cover rekapitulasi.

The table is in thousand hectares, Indonesian grouping ("1.934,60"). Each class total is the
second-to-last number on the row; the last number is a percent and is not stored. Hectares in the
artifact are that total times 1.000. The four classes must sum to the province Total row.
"""

import re
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

THOUSAND = Decimal(1000)
HECTARE = Decimal("0.01")
TOLERANCE = Decimal("0.01")
NUMBER = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{2}$")
CLASS_LABELS = {
    "- Hutan Primer": "hutan_primer",
    "- Hutan Sekunder": "hutan_sekunder",
    "- Hutan Tanaman": "hutan_tanaman",
    "B. Non Hutan": "bukan_hutan",
}
REQUIRED = ("hutan_primer", "hutan_sekunder", "hutan_tanaman", "bukan_hutan")


class LandCoverParseError(ValueError):
    pass


@dataclass(frozen=True)
class ProvinceCover:
    name: str
    hectares: dict[str, Decimal]


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.split("|") if cell.strip()]


def _numbers(cells: list[str]) -> list[Decimal]:
    return [Decimal(cell.replace(".", "").replace(",", ".")) for cell in cells if NUMBER.fullmatch(cell)]


def _hectares(thousand_ha: Decimal) -> str:
    return f"{(thousand_ha * THOUSAND).quantize(HECTARE):.2f}"


def parse_rekap(text: str) -> list[ProvinceCover]:
    provinces: list[ProvinceCover] = []
    current: str | None = None
    classes: dict[str, Decimal] = {}
    for raw in text.splitlines():
        cells = _cells(raw)
        if len(cells) >= 2 and cells[0].isdigit() and cells[1].startswith("Provinsi "):
            if current is not None:
                raise LandCoverParseError(f"provinsi {current} tidak ditutup baris Total")
            current = cells[1].removeprefix("Provinsi ").strip()
            classes = {}
            continue
        if current is None or not cells:
            continue
        label = cells[0]
        if label in CLASS_LABELS:
            numbers = _numbers(cells)
            if len(numbers) < 2:
                raise LandCoverParseError(f"{current}: baris {label} tidak punya total")
            classes[CLASS_LABELS[label]] = numbers[-2]
            continue
        if label != "Total":
            continue
        missing = [name for name in REQUIRED if name not in classes]
        if missing:
            raise LandCoverParseError(f"{current}: kelas hilang {missing}")
        numbers = _numbers(cells)
        if len(numbers) < 2:
            raise LandCoverParseError(f"{current}: baris Total tidak punya luas")
        total = numbers[-2]
        summed = sum(classes.values(), Decimal(0))
        if abs(summed - total) > TOLERANCE:
            raise LandCoverParseError(f"{current}: jumlah kelas {summed} tidak sama dengan total {total}")
        provinces.append(ProvinceCover(current, dict(classes)))
        current = None
    if current is not None:
        raise LandCoverParseError(f"provinsi {current} tidak ditutup baris Total")
    if len(provinces) != 38:
        raise LandCoverParseError(f"diharapkan 38 provinsi, terbaca {len(provinces)}")
    return provinces


def hectares_of(cover: ProvinceCover) -> dict[str, str]:
    return {name: _hectares(cover.hectares[name]) for name in REQUIRED}
