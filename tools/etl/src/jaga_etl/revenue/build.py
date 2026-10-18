"""Map DJPK revenue rows onto Kemendagri codes."""

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from jaga_etl.facts.djpk.mapping import (
    KemendagriProvince,
    KemendagriRegion,
    RegionMatcher,
    read_aliases,
)
from jaga_etl.revenue.parse import DISPLAY_LABELS, REVENUE_LINES, ParsedRevenue, parse_workbook
from jaga_etl.web_data import write_json

SOURCE_URL = (
    "https://djpk.kemenkeu.go.id/wp-content/uploads/2025/11/31102025_Data_Realisasi_Ringkas_APBD_2024.xlsx"
)
SOURCE_PAGE = "https://djpk.kemenkeu.go.id/?p=5412"
YEAR = 2024
NOTE = (
    "Realisasi pendapatan daerah 2024 per jenis, dari berkas DJPK Realisasi Ringkas APBD "
    "31 Oktober 2025. Kolom angka pada lembar data bernama nilaianggaran; halaman seri data "
    "menandai berkas ini sebagai realisasi, dan jumlah jenisnya sama dengan baris "
    "'4. Pendapatan Daerah' pada lembar ringkasan. Ini uang yang masuk ke kas daerah, bukan "
    "penghasilan warga dan bukan ukuran kemakmuran."
)


@dataclass(frozen=True)
class BuildResult:
    regions: int
    unmatched: list[str]


def _reference(path: Path) -> tuple[list[KemendagriProvince], list[KemendagriRegion]]:
    import json

    payload = json.loads(path.read_text(encoding="utf-8"))
    provinces: dict[str, str] = {}
    regions: list[KemendagriRegion] = []
    for region in payload:
        province = region["province"]
        provinces[province["code"]] = province["name"]
        regions.append(
            KemendagriRegion(code=region["code"], name=region["name"], province_code=province["code"])
        )
    return (
        [KemendagriProvince(code=code, name=name) for code, name in sorted(provinces.items())],
        regions,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_payload(
    parsed: ParsedRevenue,
    regions_path: Path,
    aliases_path: Path,
    *,
    sha256: str,
    downloaded_at: str,
) -> tuple[dict[str, object], BuildResult]:
    provinces, regions = _reference(regions_path)
    matcher = RegionMatcher(provinces, regions, read_aliases(aliases_path))
    grouped: dict[str, list] = {}
    for row in parsed.rows:
        grouped.setdefault(row.djpk_code, []).append(row)
    mapped: dict[str, dict[str, object]] = {}
    unmatched: list[str] = []
    order = list(REVENUE_LINES.values())
    for code, rows in grouped.items():
        sample = rows[0]
        province_name = parsed.province_names.get(sample.djpk_province_code, "")
        province = matcher.province(sample.djpk_province_code, province_name)
        region = None if province is None else matcher.region(sample.djpk_province_code, province, sample.djpk_name)
        if region is None:
            unmatched.append(f"{code} {sample.djpk_name} ({province_name or 'provinsi tidak dikenal'})")
            continue
        by_line = {row.line: row.amount for row in rows}
        total = sum(by_line.values(), start=Decimal("0.00"))
        mapped[region.kemendagri_code] = {
            "total_amount": f"{total:.2f}",
            "rows": [
                {"type": line, "amount": f"{by_line[line]:.2f}"}
                for line in order
                if line in by_line
            ],
        }
    if unmatched:
        return {}, BuildResult(regions=0, unmatched=unmatched)
    payload = {
        "year": YEAR,
        "source": {
            "publisher": "DJPK Kemenkeu",
            "title": "Realisasi pendapatan daerah menurut jenis, 2024",
            "url": SOURCE_URL,
            "page": SOURCE_PAGE,
            "sha256": sha256,
            "downloaded_at": downloaded_at,
        },
        "labels": DISPLAY_LABELS,
        "note": NOTE,
        "regions": mapped,
    }
    return payload, BuildResult(regions=len(mapped), unmatched=[])


def build(workbook: Path, regions_path: Path, aliases_path: Path, output_path: Path) -> BuildResult:
    parsed = parse_workbook(workbook)
    downloaded = datetime.fromtimestamp(workbook.stat().st_mtime, UTC).isoformat()
    payload, result = build_payload(
        parsed,
        regions_path,
        aliases_path,
        sha256=sha256_file(workbook),
        downloaded_at=downloaded,
    )
    if result.unmatched:
        return result
    write_json(output_path, payload)
    return result
