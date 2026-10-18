"""Read the three BPS books as text. Names stay as printed; matching is separate."""

import re
from dataclasses import dataclass

from jaga_etl.welfare.match import province_key

# Indonesian books use a comma decimal and a dot thousands separator.
_COUNT = r"\d{1,3}(?:\.\d{3})*,\d{2}"
_PERCENT = r"\d+,\d{2}"
_INDEX = r"\d+,\d{3}"
_RUPIAH = r"\d{1,3}(?:\.\d{3})+"
_THOUSANDS = r"\d{1,3}(?:\.\d{3})*"


class WelfareParseError(ValueError):
    pass


@dataclass(frozen=True)
class PovertyRow:
    province_name: str
    name: str
    people_thousands: str
    percent: str
    line_rupiah: int


@dataclass(frozen=True)
class OutputRow:
    province_name: str
    name: str
    per_person_thousands: int | None


@dataclass(frozen=True)
class DevelopmentRow:
    province_name: str
    name: str
    index: str
    adjusted_spending_thousands: int


def _comma_decimal(value: str) -> str:
    return value.replace(".", "").replace(",", ".")


def _grouped_int(value: str) -> int:
    return int(value.replace(".", ""))


def parse_poverty(text: str, province_names: set[str]) -> list[PovertyRow]:
    """Table 2.1. A wrapped or hyphenated name is joined, and only a real province name closes a group."""
    data = re.compile(
        rf"^(?:(\d+)\s+)?([A-Za-z][A-Za-z .'()-]*?)\s+({_COUNT})\s+({_PERCENT})\s+({_INDEX})\s+({_INDEX})\s+({_RUPIAH})$"
    )
    rows: list[PovertyRow] = []
    bucket: list[tuple[str, str, str, int]] = []
    held_index: str | None = None
    held_name = ""

    def close(province_name: str) -> None:
        nonlocal bucket
        rows.extend(
            PovertyRow(province_name, name, people, percent, line)
            for name, people, percent, line in bucket
        )
        bucket = []

    def add(name: str, people: str, percent: str, line: str) -> None:
        bucket.append((name, _comma_decimal(people), _comma_decimal(percent), _grouped_int(line)))

    held_prefix = ""
    for raw in text.splitlines():
        line = " ".join(raw.split())
        if not line or line.startswith("http"):
            continue
        if re.fullmatch(r"\d+", line):
            held_index = line
            held_name = ""
            continue
        matched = data.match(line)
        fragment = re.fullmatch(r"(\d+)\s+([A-Za-z][A-Za-z .'()-]*-?)", line)
        if matched is None and fragment:
            held_index = fragment.group(1)
            held_name = fragment.group(2)
            continue
        if held_index and matched is None and re.fullmatch(r"[A-Za-z][A-Za-z .'()-]*", line):
            held_name = f"{held_name} {line}".strip()
            continue
        if matched and matched.group(1) is None:
            bare = matched.group(2)
            prefixed = f"{held_prefix} {bare}".strip() if held_prefix else bare
            if province_key(prefixed) in province_names or province_key(bare) in province_names:
                close(prefixed if province_key(prefixed) in province_names else bare)
                held_index = None
                held_name = ""
                held_prefix = ""
                continue
            if held_index:
                stem = bare
                name = held_name[:-1] + stem if held_name.endswith("-") else f"{held_name} {stem}".strip()
                add(name, matched.group(3), matched.group(4), matched.group(7))
                held_index = None
                held_name = ""
                held_prefix = ""
                continue
        if held_index:
            # A lone number is usually the page number, not a row that wrapped.
            held_index = None
            held_name = ""
        if matched and matched.group(1):
            add(matched.group(2), matched.group(3), matched.group(4), matched.group(7))
            held_prefix = ""
            continue
        if re.fullmatch(r"[A-Za-z][A-Za-z .'()-]*", line):
            held_prefix = line
            continue
    if not rows:
        raise WelfareParseError("Tabel kemiskinan tidak memuat satu pun baris kabupaten/kota.")
    return rows


def parse_output(text: str) -> list[OutputRow]:
    """Per-capita GRDP at current prices. Other PDRB tables in the same book are ignored.

    A 2025 figure is kept only when the row has the five year columns and the last one is a number.
    A dash, or a row whose columns slipped apart, stays empty.
    """
    row_pattern = re.compile(
        r"^(\d{2})\.\s+(Kab\.|Kota)\s*([A-Za-z][A-Za-z .'-]*?)\s+((?:\d|[–—-]).*)$"
    )
    caption_pattern = re.compile(r"di Provinsi (.+)$")
    value_pattern = re.compile(rf"^(?:{_RUPIAH}|[–—-])$")
    rows: list[OutputRow] = []
    bucket: list[tuple[str, list[str]]] = []
    # The table number and the title swap places from page to page. Rows count only once both
    # have been seen, and only for per-capita GRDP at current prices.
    caption: str | None = None
    saw_table = False

    def flush() -> None:
        nonlocal caption, saw_table
        if caption is None or not saw_table:
            return
        for name, tokens in bucket:
            latest = _grouped_int(tokens[4]) if len(tokens) == 5 and tokens[4][:1].isdigit() else None
            rows.append(OutputRow(caption, name, latest))
        bucket.clear()
        caption = None
        saw_table = False

    for raw in text.splitlines():
        line = raw.strip()
        matched = row_pattern.match(line)
        if matched and not saw_table:
            tokens = matched.group(4).split()
            if tokens and all(value_pattern.match(token) for token in tokens):
                bucket.append((f"{matched.group(2)} {matched.group(3).strip()}", tokens))
            continue
        if "Tabel/Tabl" in line:
            saw_table = True
            flush()
            continue
        lowered = line.lower()
        found = caption_pattern.search(line)
        if line.startswith("PDRB") and found is not None and "per kapita" in lowered and "harga berlaku" in lowered:
            caption = found.group(1).strip()
            flush()
            continue
        if saw_table and caption is None and ("pdrb" in lowered or "menurut" in lowered):
            bucket.clear()
            saw_table = False
    if not rows:
        raise WelfareParseError("Tabel PDRB per kapita tidak memuat satu pun baris.")
    return rows


def parse_development(text: str) -> list[DevelopmentRow]:
    """Lampiran 2, the kabupaten/kota HDI table. An all-capital name is the province header."""
    row_pattern = re.compile(
        rf"^((?:Kota)\s+)?([A-Za-z][A-Za-z .'()-]*?)\s+{_PERCENT}\s+{_PERCENT}\s+{_PERCENT}\s+({_THOUSANDS})\s+({_PERCENT})\s+-?{_PERCENT}$"
    )
    rows: list[DevelopmentRow] = []
    province: str | None = None
    for raw in text.splitlines():
        line = " ".join(raw.split())
        matched = row_pattern.match(line)
        if matched is None:
            continue
        prefix = matched.group(1) or ""
        stem = matched.group(2)
        if prefix == "" and stem.isupper():
            province = None if stem == "INDONESIA" else stem
            continue
        if province is None:
            continue
        rows.append(
            DevelopmentRow(
                province,
                f"{prefix}{stem}",
                _comma_decimal(matched.group(4)),
                _grouped_int(matched.group(3)),
            )
        )
    if not rows:
        raise WelfareParseError("Lampiran IPM tidak memuat satu pun baris kabupaten/kota.")
    return rows
