"""Parse DJPK snapshot files into one budget record per kabupaten/kota and year.

The total APBD shown to the public is "Belanja Daerah" (regional expenditure): anggaran is the
budget, realisasi the year-end realisation. Below that aggregate DJPK prints the standard APBD
expenditure classification by "jenis belanja" (belanja pegawai, barang dan jasa, modal, bunga,
subsidi, hibah, bantuan sosial, bagi hasil, bantuan keuangan, tidak terduga), which is what the
public expenditure breakdown shows. Province-level pemda ("00") are skipped because the product
compares kabupaten/kota. The TKDD export of the same pemda supplies natural-resource revenue
sharing (see `tkdd.py`).

The export is a flat indentation tree: every account sits at the same indent and the hierarchy is
expressed by repeated label occurrences, not by columns. "Belanja Daerah" is followed by its four
direct children (Belanja Pegawai, Belanja Barang dan Jasa, Belanja Modal, Belanja Lainnya) and then
by the seven children of "Belanja Lainnya". Belanja Pegawai/Barang dan Jasa/Modal each appear twice
with identical figures (DJPK prints one line per account view); "Belanja Lainnya" is an aggregate of
the seven that follow it, so it is not published as a jenis value and never contributes to a sum.
"""

import json
import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from defusedxml import ElementTree

from jaga_etl.facts.djpk.source import (
    ALL_SENTINEL,
    PROVINCE_LEVEL_PEMDA,
    apbd_file,
    pemda_file,
    provinces_file,
    tkdd_file,
)
from jaga_etl.facts.djpk.tkdd import resource_amounts

SPREADSHEET_NS = "{urn:schemas-microsoft-com:office:spreadsheet}"
BUDGET_ACCOUNT = "Belanja Daerah"
CENTS = Decimal("0.01")
PROVINCE_OPTION = re.compile(r'<option\s+value="(\d{2})"\s*>\s*Provinsi\s+([^<]+?)\s*<', re.IGNORECASE)
# The export prints large values like 1.4119369592191E+14: 14 significant digits only.
SCIENTIFIC = re.compile(r"[eE][+-]?\d+$")
PERCENT_TOLERANCE = Decimal("0.01")

# Source label → stable jenis belanja enum value, in DJPK's own print order. The ten account labels
# below are exactly the children of Belanja Daerah once "Belanja Lainnya" is expanded, so they
# partition the total. DJPK uses one label per jenis; an unrecognised "Belanja …" label blocks.
EXPENDITURE_LABELS: dict[str, str] = {
    "Belanja Pegawai": "belanja_pegawai",
    "Belanja Barang dan Jasa": "belanja_barang_dan_jasa",
    "Belanja Modal": "belanja_modal",
    "Belanja Bunga": "belanja_bunga",
    "Belanja Subsidi": "belanja_subsidi",
    "Belanja Hibah": "belanja_hibah",
    "Belanja Bantuan Sosial": "belanja_bantuan_sosial",
    "Belanja Bagi Hasil": "belanja_bagi_hasil",
    "Belanja Bantuan Keuangan": "belanja_bantuan_keuangan",
    "Belanja Tidak Terduga": "belanja_tidak_terduga",
}

# The seven jenis that DJPK nests under the "Belanja Lainnya" aggregate line, which is printed
# alongside the three that sit directly under Belanja Daerah. The aggregate itself is never stored.
OTHER_AGGREGATE_LABEL = "Belanja Lainnya"


@dataclass(frozen=True)
class DjpkBudgetRecord:
    year: int
    djpk_province_code: str
    djpk_province_name: str
    djpk_pemda_code: str
    djpk_pemda_name: str
    budget_amount: Decimal | None
    realization_amount: Decimal | None
    reduced_precision: bool
    source_file: str


@dataclass(frozen=True)
class DjpkResourceRecord:
    year: int
    djpk_province_code: str
    djpk_province_name: str
    djpk_pemda_code: str
    djpk_pemda_name: str
    resource_type: str
    budget_amount: Decimal | None
    realization_amount: Decimal | None
    source_file: str


@dataclass(frozen=True)
class DjpkExpenditureRecord:
    """One jenis belanja line for a pemda-year; anggaran/realisasi are NULL when DJPK left them blank."""

    year: int
    djpk_province_code: str
    djpk_province_name: str
    djpk_pemda_code: str
    djpk_pemda_name: str
    expenditure_type: str
    budget_amount: Decimal | None
    realization_amount: Decimal | None
    source_file: str


@dataclass
class DjpkResult:
    records: list[DjpkBudgetRecord] = field(default_factory=list)
    resources: list[DjpkResourceRecord] = field(default_factory=list)
    expenditures: list[DjpkExpenditureRecord] = field(default_factory=list)
    # Pemda whose TKDD export was read (with or without resource lines), per year.
    tkdd_files_read: int = 0
    rejections: list[str] = field(default_factory=list)
    rows_read: int = 0


def parse_provinces(html: str) -> dict[str, str]:
    return {code: name.strip() for code, name in PROVINCE_OPTION.findall(html)}


def parse_pemda(content: bytes) -> dict[str, str]:
    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise ValueError("pemda list is not an object")
    return {
        str(code): str(name).strip()
        for code, name in payload.items()
        if code not in {ALL_SENTINEL, PROVINCE_LEVEL_PEMDA}
    }


def parse_amount(text: str) -> tuple[Decimal | None, bool]:
    """Returns (value rounded to cents, whether the source used reduced-precision notation)."""
    stripped = text.strip()
    if stripped == "":
        return None, False
    try:
        value = Decimal(stripped)
    except InvalidOperation as error:
        raise ValueError(f"not a number: {text!r}") from error
    if not value.is_finite():
        raise ValueError(f"not a finite number: {text!r}")
    if value < 0:
        raise ValueError(f"negative amount: {text!r}")
    return value.quantize(CENTS, rounding=ROUND_HALF_UP), bool(SCIENTIFIC.search(stripped))


def parse_rows(content: bytes) -> list[list[str]]:
    # defusedxml rejects entity expansion and external references in this untrusted export.
    root = ElementTree.fromstring(content)
    rows: list[list[str]] = []
    for row in root.iter(f"{SPREADSHEET_NS}Row"):
        rows.append([(data.text or "").strip() for data in row.iter(f"{SPREADSHEET_NS}Data")])
    return rows


def _budget_row(rows: list[list[str]]) -> list[str] | None:
    header = rows[0] if rows else []
    if header[:3] != ["Akun", "Anggaran", "Realisasi"]:
        raise ValueError(f"unexpected header {header!r}")
    matches = [row for row in rows[1:] if row and row[0] == BUDGET_ACCOUNT]
    if len(matches) > 1:
        raise ValueError(f"{len(matches)} '{BUDGET_ACCOUNT}' rows")
    return matches[0] if matches else None


def _check_percentage(row: list[str], budget: Decimal | None, realization: Decimal | None) -> None:
    if budget is None or realization is None or budget == 0 or len(row) < 4 or row[3] == "":
        return
    reported = Decimal(row[3])
    computed = (realization / budget * 100).quantize(CENTS, rounding=ROUND_HALF_UP)
    if abs(reported - computed) > PERCENT_TOLERANCE:
        raise ValueError(f"reported {reported}% but amounts give {computed}%")


def expenditure_rows(rows: list[list[str]]) -> list[tuple[str, Decimal | None, Decimal | None]]:
    """The jenis belanja lines that sit between "Belanja Daerah" and "Pembiayaan Daerah".

    Returns (jenis enum, anggaran, realisasi) in the source's own order, one entry per jenis. A
    repeated label must carry identical figures (DJPK prints the same account twice); a mismatch
    means the file was not understood. "Belanja Lainnya" is the aggregate header of the trailing
    seven jenis, so it is skipped; any other unknown "Belanja …" label is a mapping gap and blocks.
    """
    header = rows[0] if rows else []
    if header[:3] != ["Akun", "Anggaran", "Realisasi"]:
        raise ValueError(f"unexpected header {header!r}")

    start = next((index for index, row in enumerate(rows) if row and row[0] == BUDGET_ACCOUNT), None)
    if start is None:
        return []

    extracted: dict[str, tuple[str, Decimal | None, Decimal | None]] = {}
    for row in rows[start + 1 :]:
        label = row[0] if row else ""
        if label == "Pembiayaan Daerah" or not label.startswith("Belanja "):
            break
        if label == OTHER_AGGREGATE_LABEL:
            continue
        jenis = EXPENDITURE_LABELS.get(label)
        if jenis is None:
            raise ValueError(f"unknown expenditure account {label!r}")
        budget = parse_amount(row[1] if len(row) > 1 else "")[0]
        realization = parse_amount(row[2] if len(row) > 2 else "")[0]
        if jenis in extracted:
            if extracted[jenis][1:] != (budget, realization):
                raise ValueError(f"{label!r} appears with different amounts")
            continue
        extracted[jenis] = (jenis, budget, realization)
    return list(extracted.values())


def normalize(contents: dict[str, bytes], years: tuple[int, ...]) -> DjpkResult:
    result = DjpkResult()
    for year in years:
        provinces_name = provinces_file(year)
        if provinces_name not in contents:
            result.rejections.append(f"missing snapshot file {provinces_name}")
            continue
        provinces = parse_provinces(contents[provinces_name].decode("utf-8", errors="replace"))
        for province_code, province_name in sorted(provinces.items()):
            pemda_name_file = pemda_file(year, province_code)
            if pemda_name_file not in contents:
                result.rejections.append(f"missing snapshot file {pemda_name_file}")
                continue
            for pemda_code, pemda_name in sorted(parse_pemda(contents[pemda_name_file]).items()):
                name = apbd_file(year, province_code, pemda_code)
                result.rows_read += 1
                if name not in contents:
                    result.rejections.append(f"missing snapshot file {name}")
                    continue
                try:
                    parsed = parse_rows(contents[name])
                    row = _budget_row(parsed)
                    expenditures = expenditure_rows(parsed)
                    if row is None:
                        budget = realization = None
                        reduced = False
                    else:
                        budget, reduced_budget = parse_amount(row[1] if len(row) > 1 else "")
                        realization, reduced_realization = parse_amount(row[2] if len(row) > 2 else "")
                        reduced = reduced_budget or reduced_realization
                        _check_percentage(row, budget, realization)
                except (ValueError, ElementTree.ParseError) as error:
                    result.rejections.append(f"{name} ({pemda_name}): {error}")
                    continue
                _read_resources(result, contents, year, province_code, province_name, pemda_code, pemda_name)
                result.records.append(
                    DjpkBudgetRecord(
                        year=year,
                        djpk_province_code=province_code,
                        djpk_province_name=province_name,
                        djpk_pemda_code=pemda_code,
                        djpk_pemda_name=pemda_name,
                        budget_amount=budget,
                        realization_amount=realization,
                        reduced_precision=reduced,
                        source_file=name,
                    )
                )
                result.expenditures.extend(
                    DjpkExpenditureRecord(
                        year=year,
                        djpk_province_code=province_code,
                        djpk_province_name=province_name,
                        djpk_pemda_code=pemda_code,
                        djpk_pemda_name=pemda_name,
                        expenditure_type=jenis,
                        budget_amount=jenis_budget,
                        realization_amount=jenis_realization,
                        source_file=name,
                    )
                    for jenis, jenis_budget, jenis_realization in expenditures
                )
    return result


def _read_resources(
    result: DjpkResult,
    contents: dict[str, bytes],
    year: int,
    province_code: str,
    province_name: str,
    pemda_code: str,
    pemda_name: str,
) -> None:
    name = tkdd_file(year, province_code, pemda_code)
    if name not in contents:
        result.rejections.append(f"missing snapshot file {name}")
        return
    try:
        amounts = resource_amounts(parse_rows(contents[name]))
    except (ValueError, ElementTree.ParseError) as error:
        result.rejections.append(f"{name} ({pemda_name}): {error}")
        return
    result.tkdd_files_read += 1
    result.resources.extend(
        DjpkResourceRecord(
            year=year,
            djpk_province_code=province_code,
            djpk_province_name=province_name,
            djpk_pemda_code=pemda_code,
            djpk_pemda_name=pemda_name,
            resource_type=amount.resource_type,
            budget_amount=amount.budget_amount,
            realization_amount=amount.realization_amount,
            source_file=name,
        )
        for amount in amounts
    )
