"""DJPK realisasi ringkas 2024: pendapatan daerah per pemda.

Sheet2 is one row per pemda and jenis akun. The value column is named nilaianggaran inside a file
the series page publishes as realisasi (31 October 2025). Province rows (.00) are kept only so
the pivot check can see them; they are not kabupaten/kota figures.
"""

import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path

from defusedxml import ElementTree

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Jenis akun under "4. PENDAPATAN DAERAH", in the order DJPK prints them.
REVENUE_LINES: dict[str, str] = {
    "4101. Pajak Daerah": "pajak_daerah",
    "4102. Retribusi Daerah": "retribusi_daerah",
    "4103. Hasil Pengelolaan Kekayaan Daerah yang Dipisahkan": "hasil_kekayaan_dipisahkan",
    "4104. Lain-lain PAD yang Sah": "lain_lain_pad",
    "4201. Pendapatan Transfer Pemerintah Pusat": "transfer_pemerintah_pusat",
    "4202. Pendapatan Transfer Antar Daerah": "transfer_antar_daerah",
    "4301. Pendapatan Hibah": "hibah",
    "4302. Dana Darurat": "dana_darurat",
    "4303. Lain-lain Pendapatan Sesuai dengan Ketentuan Peraturan Perundang-Undangan": "lain_lain_pendapatan",
}

DISPLAY_LABELS: dict[str, str] = {
    "pajak_daerah": "Pajak daerah",
    "retribusi_daerah": "Retribusi daerah",
    "hasil_kekayaan_dipisahkan": "Hasil pengelolaan kekayaan daerah",
    "lain_lain_pad": "Lain-lain PAD yang sah",
    "transfer_pemerintah_pusat": "Transfer pemerintah pusat",
    "transfer_antar_daerah": "Transfer antar daerah",
    "hibah": "Hibah",
    "dana_darurat": "Dana darurat",
    "lain_lain_pendapatan": "Lain-lain pendapatan yang sah",
}


class RevenueParseError(ValueError):
    pass


@dataclass(frozen=True)
class RevenueRow:
    djpk_code: str
    djpk_name: str
    djpk_province_code: str
    line: str
    amount: Decimal


@dataclass
class ParsedRevenue:
    rows: list[RevenueRow] = field(default_factory=list)
    province_names: dict[str, str] = field(default_factory=dict)
    pivot_total: dict[str, Decimal] = field(default_factory=dict)


def _column(ref: str) -> str:
    return "".join(character for character in ref if character.isalpha())


def _amount(text: str) -> Decimal:
    try:
        value = Decimal(text)
    except InvalidOperation as error:
        raise RevenueParseError(f"bukan angka: {text!r}") from error
    if not value.is_finite() or value < 0:
        raise RevenueParseError(f"nilai harus terbatas dan tidak negatif: {text!r}")
    return value.quantize(Decimal("0.01"))


def _strings(archive: zipfile.ZipFile) -> list[str]:
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    return [
        "".join(node.text or "" for node in item.iter(f"{NS}t")) for item in root.findall(f"{NS}si")
    ]


def _cell_text(cell, strings: list[str]) -> str:
    kind = cell.attrib.get("t")
    value = cell.find(f"{NS}v")
    if kind == "s" and value is not None and value.text:
        return strings[int(value.text)]
    if value is not None and value.text:
        return value.text
    return ""


def _rows(archive: zipfile.ZipFile, sheet: str, strings: list[str]) -> list[dict[str, str]]:
    parsed: list[dict[str, str]] = []
    with archive.open(sheet) as handle:
        for _event, row in ElementTree.iterparse(handle, events=("end",)):
            if row.tag != f"{NS}row":
                continue
            cells = {
                _column(cell.attrib.get("r", "")): _cell_text(cell, strings)
                for cell in row.findall(f"{NS}c")
            }
            row.clear()
            if any(cells.values()):
                parsed.append(cells)
    return parsed


def parse_workbook(path: Path) -> ParsedRevenue:
    with zipfile.ZipFile(path) as archive:
        strings = _strings(archive)
        detail = _rows(archive, "xl/worksheets/sheet2.xml", strings)
        pivot = _rows(archive, "xl/worksheets/sheet1.xml", strings)

    result = ParsedRevenue()
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0.00"))
    seen: dict[tuple[str, str], RevenueRow] = {}
    for cells in detail:
        code = cells.get("A", "")
        label = cells.get("C", "")
        parent = cells.get("E", "")
        if code in {"", "kodepemda"} or parent != "4. PENDAPATAN DAERAH":
            continue
        line = REVENUE_LINES.get(label)
        if line is None:
            raise RevenueParseError(f"jenis pendapatan tidak dikenal: {label!r}")
        name = cells.get("B", "")
        if code.endswith(".00"):
            result.province_names[code[:2]] = name.removeprefix("Provinsi ").strip()
            continue
        amount = _amount(cells.get("F", ""))
        key = (code, line)
        if key in seen:
            raise RevenueParseError(f"baris ganda {code} {label}")
        row = RevenueRow(code, name, code[:2], line, amount)
        seen[key] = row
        result.rows.append(row)
        totals[code] += amount

    code_by_column: dict[str, str] = {}
    for cells in pivot:
        if "01.00" in cells.values():
            code_by_column = {column: value for column, value in cells.items() if value.count(".") == 1}
            break
    if not code_by_column:
        raise RevenueParseError("baris kode pemda pada sheet ringkas tidak ditemukan")
    for cells in pivot:
        if cells.get("A") != "4. PENDAPATAN DAERAH":
            continue
        for column, code in code_by_column.items():
            if column == "A" or code.endswith(".00"):
                continue
            text = cells.get(column)
            if text:
                result.pivot_total[code] = _amount(text)
        break
    if not result.pivot_total:
        raise RevenueParseError("baris total pendapatan pada sheet ringkas tidak ditemukan")

    for code, total in totals.items():
        pivot_total = result.pivot_total.get(code)
        if pivot_total is None:
            raise RevenueParseError(f"{code} ada di rincian tetapi tidak di ringkasan")
        if abs(pivot_total - total) > Decimal("1.00"):
            raise RevenueParseError(f"{code}: jumlah jenis {total} tidak sama dengan ringkasan {pivot_total}")
    return result
