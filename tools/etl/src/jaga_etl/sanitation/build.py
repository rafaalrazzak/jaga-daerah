"""Match BPS sanitation labels to Kemendagri regions and write the profile artifact."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.sanitation.parse import PAGE_URL, YEAR_LABEL, SanitationError, SanitationTable, extract_table
from jaga_etl.welfare.match import region_key
from jaga_etl.web_data import write_json

# Rows read off the 29 August 2026 table. A Papua pair is included because BPS still numbers
# those kabupaten with the pre-pemekaran codes, which are not the Kemendagri codes.
SPOT_CHECKS = {
    "11.09": "78.94",
    "32.73": "56.50",
    "51.03": "100.00",
    "76.01": "84.15",
    "93.01": "88.37",
    "94.05": None,
    "95.01": "43.70",
    "95.08": "4.00",
}

TITLE = "6.2.1* Persentase rumah tangga yang memiliki akses terhadap sanitasi layak menurut kabupaten/kota"


@dataclass(frozen=True)
class BuildResult:
    regions: int
    blank: int


def build(page: Path, regions_path: Path, output: Path) -> BuildResult:
    html_bytes = page.read_bytes()
    table = extract_table(html_bytes.decode("utf-8"))
    regions = _read_regions(regions_path)
    assigned = _assign(table, regions)
    published = {code: percent for code, percent in assigned.items() if percent is not None}
    if len(assigned) >= 500:
        for code, expected in SPOT_CHECKS.items():
            actual = assigned.get(code)
            if actual != expected:
                raise SanitationError(f"Spot check failed for {code}: expected {expected}, got {actual}")
    payload = {
        "year": int(YEAR_LABEL),
        "source": {
            "publisher": "Badan Pusat Statistik",
            "title": TITLE,
            "url": PAGE_URL,
            "sha256": hashlib.sha256(html_bytes).hexdigest(),
            "retrieved_at": datetime.now(UTC).isoformat(),
        },
        "note": _note(table.last_update),
        "regions": {code: {"percent": published[code]} for code in sorted(published)},
    }
    write_json(output, payload)
    return BuildResult(len(published), len(assigned) - len(published))


def _note(last_update: str) -> str:
    return (
        "Persentase rumah tangga dengan akses sanitasi layak tahun 2025, Badan Pusat Statistik, "
        "indikator 6.2.1* pada tabel statistik kabupaten/kota. "
        "BPS mengartikannya sebagai rumah tangga yang punya jamban leher angsa milik sendiri atau bersama, "
        "dan tempat pembuangan akhir tinja berupa tangki septik atau sistem pengolahan air limbah. "
        "Sumber hitungannya Susenas KOR. Ini bukan status desa stop buang air besar sembarangan, "
        "dan bukan sanitasi aman. "
        "Kode pada tabel BPS tidak dipakai: nama dicocokkan ke kode Kemendagri, "
        "dan Mamuju Utara dibaca sebagai Kabupaten Pasangkayu (PP Nomor 61 Tahun 2017). "
        f"Cap waktu pembaruan yang tercetak pada tabel: {last_update}. "
        "Sel yang tidak diisi dikosongkan, tidak diisi nol."
    )


def _read_regions(path: Path) -> list[dict[str, object]]:
    parsed = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, list):
        raise SanitationError("regions.json is not a list")
    return parsed


def _assign(table: SanitationTable, regions: list[dict[str, object]]) -> dict[str, str | None]:
    by_key: dict[tuple[str, str], str] = {}
    codes: list[str] = []
    for region in regions:
        code = region.get("code")
        name = region.get("name")
        if not isinstance(code, str) or not isinstance(name, str):
            raise SanitationError("regions.json has a region without a code and name")
        key = region_key(name)
        existing = by_key.get(key)
        if existing is not None and existing != code:
            raise SanitationError(f"Two regions share the name key {key}: {existing} and {code}")
        by_key[key] = code
        codes.append(code)

    assigned: dict[str, str | None] = {}
    unmatched: list[str] = []
    for row in table.rows:
        code = by_key.get(region_key(row.label))
        if code is None:
            unmatched.append(f"{row.bps_code} {row.label}")
            continue
        if code in assigned:
            raise SanitationError(f"Two BPS rows match {code}: {row.label}")
        assigned[code] = row.percent
    missing = [code for code in codes if code not in assigned]
    if unmatched or missing:
        raise SanitationError(
            "Sanitation rows do not cover the Kemendagri list. "
            f"Unmatched BPS: {unmatched[:8]}. Missing regions: {missing[:8]}."
        )
    return assigned
