"""Read DJPK's national "Realisasi Belanja Daerah" workbook.

Sheet2 is one row per pemda × jenis belanja × fungsi, with a single `nilai` (realisasi, rupiah).
Province rows (`kodepemda` ending in `.00`) are skipped. "Kesehatan Tagging" and "Pendidikan
Tagging" are folded into kesehatan and pendidikan: nationally, the sum of every row including
those tagging lines is the figure that lines up with total Belanja Daerah, so tagging is part of
the total rather than a second copy of the same rupiah.

An unrecognised fungsi label raises. This file does not publish a pagu, so anggaran stays absent.
"""

import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from defusedxml import ElementTree

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
HEADER = "AkunAnalisismap"

# Source label → stable function id. Tagging labels share the parent id on purpose.
FUNCTION_LABELS: dict[str, str] = {
    "01. Pelayanan Umum": "pelayanan_umum",
    "03. Ketertiban Dan Keamanan": "ketertiban_dan_keamanan",
    "04. Ekonomi": "ekonomi",
    "05. Perlindungan Lingkungan Hidup": "perlindungan_lingkungan_hidup",
    "06. Perumahan Dan Fasilitas Umum": "perumahan_dan_fasilitas_umum",
    "07. Kesehatan": "kesehatan",
    "07. Kesehatan Tagging": "kesehatan",
    "08. Pariwisata": "pariwisata",
    "10. Pendidikan": "pendidikan",
    "10. Pendidikan Tagging": "pendidikan",
    "11. Perlindungan Sosial": "perlindungan_sosial",
}

DISPLAY_LABELS: dict[str, str] = {
    "pelayanan_umum": "Pelayanan umum",
    "ketertiban_dan_keamanan": "Ketertiban dan keamanan",
    "ekonomi": "Ekonomi",
    "perlindungan_lingkungan_hidup": "Perlindungan lingkungan hidup",
    "perumahan_dan_fasilitas_umum": "Perumahan dan fasilitas umum",
    "kesehatan": "Kesehatan",
    "pariwisata": "Pariwisata",
    "pendidikan": "Pendidikan",
    "perlindungan_sosial": "Perlindungan sosial",
}


class FunctionParseError(Exception):
    pass


@dataclass(frozen=True)
class PemdaFunction:
    djpk_code: str
    djpk_name: str
    djpk_province_code: str
    function: str
    realization: Decimal


@dataclass
class ParsedWorkbook:
    functions: list[PemdaFunction] = field(default_factory=list)
    province_names: dict[str, str] = field(default_factory=dict)


def _column(ref: str) -> str:
    return "".join(character for character in ref if character.isalpha())


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{NS}t"))
        for item in root.findall(f"{NS}si")
    ]


def _cell_text(cell, strings: list[str]) -> str:
    kind = cell.attrib.get("t")
    value = cell.find(f"{NS}v")
    if kind == "s" and value is not None and value.text:
        return strings[int(value.text)]
    if kind == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(f"{NS}t"))
    if value is not None and value.text:
        return value.text
    return ""


def _amount(text: str) -> Decimal:
    try:
        value = Decimal(text)
    except InvalidOperation as error:
        raise FunctionParseError(f"not a number: {text!r}") from error
    if not value.is_finite() or value < 0:
        raise FunctionParseError(f"nilai must be a non-negative finite number, got {text!r}")
    return value.quantize(Decimal("0.01"))


def parse_workbook(path: Path) -> ParsedWorkbook:
    """Aggregate sheet2 to one realisasi per kabupaten/kota and function."""
    totals: dict[tuple[str, str], Decimal] = defaultdict(lambda: Decimal("0.00"))
    names: dict[str, str] = {}
    provinces: dict[str, str] = {}
    with zipfile.ZipFile(path) as archive:
        strings = _shared_strings(archive)
        with archive.open("xl/worksheets/sheet2.xml") as sheet:
            for _event, row in ElementTree.iterparse(sheet, events=("end",)):
                if row.tag != f"{NS}row":
                    continue
                cells: dict[str, str] = {}
                for cell in row.findall(f"{NS}c"):
                    cells[_column(cell.attrib.get("r", ""))] = _cell_text(cell, strings)
                row.clear()
                label = cells.get("B", "")
                code = cells.get("C", "")
                name = cells.get("D", "")
                if cells.get("A") == HEADER or code == "":
                    continue
                if code.endswith(".00"):
                    provinces[code[:2]] = name
                    continue
                function = FUNCTION_LABELS.get(label)
                if function is None:
                    raise FunctionParseError(f"unknown function label {label!r}")
                totals[(code, function)] += _amount(cells.get("E", ""))
                names[code] = name
    return ParsedWorkbook(
        functions=[
            PemdaFunction(
                djpk_code=code,
                djpk_name=names[code],
                djpk_province_code=code[:2],
                function=function,
                realization=amount,
            )
            for (code, function), amount in sorted(totals.items())
        ],
        province_names=provinces,
    )
