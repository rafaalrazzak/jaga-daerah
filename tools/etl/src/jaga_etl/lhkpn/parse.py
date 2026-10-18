"""Read a human-saved KPK e-Announcement results page into report rows.

This module never requests the page, and neither does anything that calls it: KPK's e-Announcement
search is reCAPTCHA-gated and offers no public API, so a human runs the search in a browser and saves
the result, and this module only reads that file (`data/captures/README.md` records the rule and its
evidence). Cells are addressed through the table header, and the announcement id, reporting year and
report code come from the hidden cells KPK adds to every row, so nothing here depends on how a row
formats a number. NIK and every other identifier are dropped at extraction, before anything is
staged (`docs/SECURITY.md`, "Personal Data (LHKPN)").
"""

import html
import json
import re
from dataclasses import dataclass
from decimal import Decimal

ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.DOTALL | re.IGNORECASE)
CELL = re.compile(r"<(td|th)\b([^>]*)>(.*?)</\1>", re.DOTALL | re.IGNORECASE)
CLASS = re.compile(r'class\s*=\s*"([^"]*)"', re.IGNORECASE)
TAG = re.compile(r"<[^>]+>")
YEAR = re.compile(r"(?:19|20)\d{2}")
CENTS = re.compile(r",(\d{2})\s*$")

# Hidden cells ride along in every row (`<td class="lhkpn" ...>`); `lhkpn` is a prefix of `lhkpnori`,
# so the longer name is tested first. `nik` is read only in order to be dropped.
HIDDEN = ("lhkpnori", "nik", "tgl_lapor", "jenis_laporan", "lhkpn")
# The header labels a results table must carry before its rows can be read positionally.
REQUIRED_COLUMNS = ("nama", "lembaga", "jabatan", "total harta kekayaan")
REPORT_CODES = {"R": "Periodik", "K": "Khusus"}
ANN_ID = re.compile(r"^[0-9a-f]{8}$")
# RupiahSchema (`packages/contracts`) allows 18 integer digits; anything longer is not a figure.
MAX_DIGITS = 18


class CaptureError(ValueError):
    """A capture cannot be read, or a row cannot become a publishable figure."""


@dataclass(frozen=True)
class CaptureRow:
    """One result row exactly as published; the gate decides what may be published from it."""

    announcement_id: str
    name: str
    lembaga: str
    unit_kerja: str
    position: str
    reported_on: str
    report_code: str
    report_type: str
    amount: str
    year: int | None


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", fragment))).strip()


def _field(attributes: str) -> str:
    """The hidden field a cell carries, or "" for a visible cell."""
    match = CLASS.search(attributes)
    if match is None:
        return ""
    tokens = match.group(1).split()
    return next((name for name in HIDDEN if name in tokens), "")


def _cells(row: str) -> list[tuple[str, str]]:
    """(hidden field or "", text) per cell, in document order."""
    return [(_field(attributes), _text(body)) for _, attributes, body in CELL.findall(row)]


def _header(rows: list[str], name: str) -> tuple[int, dict[str, int]]:
    """Index of the header row and its visible label → column index."""
    for index, row in enumerate(rows):
        labels = [text.casefold() for field, text in _cells(row) if not field]
        if all(column in labels for column in REQUIRED_COLUMNS):
            return index, {label: position for position, label in enumerate(labels)}
    raise CaptureError(
        f"{name}: no results table: no row carries the columns {', '.join(REQUIRED_COLUMNS)}"
    )


def _year(hidden: str, display: str) -> int | None:
    match = YEAR.search(hidden) or YEAR.search(display)
    return None if match is None else int(match.group())


def parse_amount(text: str) -> str:
    """" Rp.12.641.245.449" → "12641245449.00"; anything else raises.

    KPK prints whole rupiah with dot thousand separators, but a comma with two digits is read as the
    cents of an Indonesian decimal format so the two spellings can never be confused by a factor of
    a hundred. A missing, zero or non-numeric value is unusable, not zero.
    """
    cents = CENTS.search(text)
    digits = re.sub(r"\D", "", text[: cents.start()] if cents else text)
    if not digits or len(digits) > MAX_DIGITS:
        raise CaptureError(f"not a rupiah amount: {text.strip()!r}")
    if Decimal(digits) <= 0:
        raise CaptureError(f"not a positive rupiah amount: {text.strip()!r}")
    return f"{Decimal(digits)}.{cents.group(1) if cents else '00'}"


def _capture_row(fields: dict[str, str], visible: list[str], header: dict[str, int], name: str) -> CaptureRow:
    def cell(column: str, *, required: bool) -> str:
        index = header.get(column, -1)
        value = visible[index] if 0 <= index < len(visible) else ""
        if required and not value:
            raise CaptureError(f"{name}: a row is missing its {column!r} cell")
        return value

    reported_on = cell("tanggal lapor", required=False)
    return CaptureRow(
        announcement_id=fields.get("lhkpn", "").casefold(),
        name=cell("nama", required=True),
        lembaga=cell("lembaga", required=True),
        unit_kerja=cell("unit kerja", required=False),
        position=cell("jabatan", required=True),
        reported_on=reported_on,
        report_code=fields.get("jenis_laporan", "").upper(),
        report_type=cell("jenis laporan", required=False),
        amount=cell("total harta kekayaan", required=True),
        year=_year(fields.get("tgl_lapor", ""), reported_on),
    )


def _strings(payload: object) -> list[str]:
    if isinstance(payload, str):
        return [payload]
    if isinstance(payload, dict):
        return [text for value in payload.values() for text in _strings(value)]
    if isinstance(payload, list):
        return [text for value in payload for text in _strings(value)]
    return []


def _page(content: bytes, name: str) -> str:
    """The HTML the capture holds: the saved page itself, or the HTML inside a raw JSON response."""
    if name.casefold().endswith(".json"):
        try:
            payload = json.loads(content)
        except ValueError as error:
            raise CaptureError(f"{name}: not a readable JSON capture ({error})") from error
        fragments = [text for text in _strings(payload) if "<tr" in text.casefold()]
        if not fragments:
            raise CaptureError(f"{name}: JSON capture holds no HTML results table")
        return max(fragments, key=len)
    if not content.strip():
        raise CaptureError(f"{name}: capture file is empty")
    page = content.decode("utf-8", errors="replace")
    # A saved page always has markup; a text dump with no tags is not a page, and saying so beats
    # reporting a missing table the file never could have contained.
    if "<" not in page:
        raise CaptureError(f"{name}: not an HTML page (no markup found)")
    return page


def parse_capture(content: bytes, name: str) -> list[CaptureRow]:
    """Every result row in a saved page; `name` labels the capture in error messages."""
    rows = ROW.findall(_page(content, name))
    header_index, header = _header(rows, name)
    parsed: list[CaptureRow] = []
    for index, row in enumerate(rows):
        if index == header_index:
            continue
        cells = _cells(row)
        if not cells or all(field for field, _ in cells):
            continue
        parsed.append(_capture_row(dict(cells), [text for field, text in cells if not field], header, name))
    if not parsed:
        raise CaptureError(f"{name}: results table has no data rows")
    return parsed


def read_capture(path) -> list[CaptureRow]:
    return parse_capture(path.read_bytes(), path.name)
