"""Read the BPS static table for SDG indicator 6.2.1* out of the public page.

The statistics-table page embeds one JSON object (variable, regions, and cells) in its
server payload. BPS codes are not Kemendagri codes, so this module returns labels and
leaves the match to the builder.
"""

import json
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

VARIABLE_ID = "2748"
YEAR_LABEL = "2025"
PAGE_URL = (
    "https://www.bps.go.id/id/statistics-table/2/Mjc0OCMy/"
    "6-2-1-persentase-rumah-tangga-yang-memiliki-akses-terhadap-sanitasi-layak-"
    "menurut-kabupaten-kota-persen.html"
)
CENTS = Decimal("0.01")
_PUSH = re.compile(r"self\.__next_f\.push\(\[1,(\"(?:\\.|[^\"\\])*\")\]\)")
_UPDATED = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")


class SanitationError(Exception):
    pass


@dataclass(frozen=True)
class SanitationRow:
    bps_code: str
    label: str
    # None is a row BPS listed without a number. The public CSV prints that cell as a dash.
    percent: str | None


@dataclass(frozen=True)
class SanitationTable:
    last_update: str
    rows: list[SanitationRow]


def extract_table(html: str) -> SanitationTable:
    """Return the 6.2.1* table embedded in a saved BPS statistics-table page."""
    decoder = json.JSONDecoder(parse_float=str, parse_int=str)
    found: list[dict[str, object]] = []
    for match in _PUSH.finditer(html):
        text = json.loads(match.group(1))
        if not isinstance(text, str) or '"datacontent"' not in text:
            continue
        cursor = 0
        while True:
            start = text.find('"datacontent"', cursor)
            if start < 0:
                break
            data_key = text.rfind('"data"', 0, start)
            obj_start = text.find("{", data_key) if data_key >= 0 else -1
            if obj_start < 0:
                cursor = start + len('"datacontent"')
                continue
            try:
                obj, _ = decoder.raw_decode(text, obj_start)
            except json.JSONDecodeError:
                cursor = start + len('"datacontent"')
                continue
            if isinstance(obj, dict) and "datacontent" in obj and "var" in obj:
                found.append(obj)
            cursor = start + len('"datacontent"')
    tables = [obj for obj in found if _variable_id(obj) == VARIABLE_ID]
    if len(tables) != 1:
        raise SanitationError(f"Expected one BPS table for variable {VARIABLE_ID}, found {len(tables)}")
    return _parse_table(tables[0])


def _variable_id(obj: dict[str, object]) -> str | None:
    var = obj.get("var")
    if not isinstance(var, list) or len(var) != 1 or not isinstance(var[0], dict):
        return None
    val = var[0].get("val")
    return val if isinstance(val, str) else None


def _parse_table(obj: dict[str, object]) -> SanitationTable:
    if obj.get("status") != "OK" or obj.get("data-availability") != "available":
        raise SanitationError("BPS table is not marked available")
    last_update = obj.get("last_update")
    if not isinstance(last_update, str) or _UPDATED.fullmatch(last_update) is None:
        raise SanitationError("BPS table has no readable last_update")
    var = _one_object(obj, "var")
    if var.get("val") != VARIABLE_ID or var.get("unit") != "Persen" or var.get("decimal") != "2":
        raise SanitationError("BPS variable is not 6.2.1* in percent with two decimals")
    note = var.get("note")
    if not isinstance(note, str):
        raise SanitationError("BPS definition is no longer decent sanitation from Susenas KOR")
    lowered = note.lower()
    if "tangki septik" not in lowered or "susenas kor" not in lowered:
        raise SanitationError("BPS definition is no longer decent sanitation from Susenas KOR")
    if obj.get("labelvervar") != "Kabupaten/Kota":
        raise SanitationError("BPS table is not kabupaten/kota")
    turvar = _one_object(obj, "turvar").get("val")
    tahun = _year_id(obj)
    turtahun = _one_object(obj, "turtahun").get("val")
    if turvar != "0" or turtahun != "0" or not isinstance(tahun, str):
        raise SanitationError("BPS table is not a single full year")

    vervar = obj.get("vervar")
    cells = obj.get("datacontent")
    if not isinstance(vervar, list) or not isinstance(cells, dict):
        raise SanitationError("BPS table has no region rows")
    expected_keys: set[str] = set()
    rows: list[SanitationRow] = []
    seen: set[str] = set()
    for item in vervar:
        if not isinstance(item, dict):
            raise SanitationError("BPS region row is not an object")
        code = item.get("val")
        label = item.get("label")
        if not isinstance(code, str) or not isinstance(label, str) or label.strip() == "":
            raise SanitationError("BPS region row is missing a code or name")
        if not re.fullmatch(r"\d{4}", code):
            raise SanitationError(f"BPS region code is not 4 digits: {code}")
        if code in seen:
            raise SanitationError(f"Duplicate BPS region code {code}")
        seen.add(code)
        key = f"{code}{VARIABLE_ID}{turvar}{tahun}{turtahun}"
        raw = cells.get(key) if key in cells else None
        if raw is None:
            # The region is on the table and the 2025 cell is blank. That is not zero.
            rows.append(SanitationRow(code, label.strip(), None))
            if key in cells:
                expected_keys.add(key)
            continue
        if not isinstance(raw, str):
            raise SanitationError(f"Percent is not a number for BPS {code} {label}")
        expected_keys.add(key)
        rows.append(SanitationRow(code, label.strip(), _percent(raw, f"{code} {label}")))
    extra = set(cells) - expected_keys
    if extra:
        raise SanitationError(f"BPS cells are not the 2025 kabupaten/kota series: {sorted(extra)[:3]}")
    if not rows:
        raise SanitationError("BPS table has no rows")
    return SanitationTable(last_update, rows)


def _one_object(obj: dict[str, object], key: str) -> dict[str, object]:
    value = obj.get(key)
    if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
        raise SanitationError(f"BPS field {key} is not a single entry")
    return value[0]


def _year_id(obj: dict[str, object]) -> str:
    tahun = obj.get("tahun")
    if not isinstance(tahun, list):
        raise SanitationError("BPS table has no year")
    matches = [
        item.get("val")
        for item in tahun
        if isinstance(item, dict) and item.get("label") == YEAR_LABEL and isinstance(item.get("val"), str)
    ]
    if len(matches) != 1 or not isinstance(matches[0], str) or not re.fullmatch(r"\d{3}", matches[0]):
        raise SanitationError(f"BPS table has no single {YEAR_LABEL} column")
    return matches[0]


def _percent(raw: str, where: str) -> str:
    if re.fullmatch(r"\d+(?:\.\d+)?", raw) is None:
        raise SanitationError(f"Percent is not a number for {where}: {raw}")
    value = Decimal(raw)
    if value < 0 or value > 100:
        raise SanitationError(f"Percent is outside 0–100 for {where}: {raw}")
    quantized = value.quantize(CENTS, rounding=ROUND_HALF_UP)
    if quantized != value:
        raise SanitationError(f"Percent has more than two decimals for {where}: {raw}")
    return f"{quantized:.2f}"
