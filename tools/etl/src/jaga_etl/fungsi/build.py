"""Map the DJPK function workbook onto Kemendagri codes and write the web artifact.

Matching reuses the reviewed alias file from the APBD pipeline. A pemda name that does not match
is listed and the build stops; nothing is guessed. A region absent from the workbook is simply
omitted (the page says the figure is unavailable).
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.facts.djpk.mapping import (
    KemendagriProvince,
    KemendagriRegion,
    RegionMatcher,
    read_aliases,
)
from jaga_etl.fungsi.parse import DISPLAY_LABELS, ParsedWorkbook, PemdaFunction, parse_workbook
from jaga_etl.web_data import write_json

SOURCE_URL = (
    "https://djpk.kemenkeu.go.id/wp-content/uploads/2025/11/31102025_Realisasi_Belanja_Daerah_2024.xlsx"
)
SOURCE_PAGE = "https://djpk.kemenkeu.go.id/?p=5412"
YEAR = 2024
NOTE = (
    "Realisasi 2024 menurut fungsi belanja, dari berkas DJPK 31 Oktober 2025. Berkas ini tidak "
    "memuat pagu. Baris Kesehatan Tagging dan Pendidikan Tagging dijumlahkan ke fungsi kesehatan "
    "dan pendidikan, karena jumlah seluruh baris (termasuk tagging) yang sejajar dengan total "
    "belanja daerah. Ini urusan belanja, bukan program atau dinas."
)


@dataclass(frozen=True)
class BuildResult:
    regions: int
    unmatched: list[str]


def _reference(path: Path) -> tuple[list[KemendagriProvince], list[KemendagriRegion]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    provinces: dict[str, str] = {}
    regions: list[KemendagriRegion] = []
    for region in payload:
        province = region["province"]
        provinces[province["code"]] = province["name"]
        regions.append(
            KemendagriRegion(
                code=region["code"], name=region["name"], province_code=province["code"]
            )
        )
    return (
        [KemendagriProvince(code=code, name=name) for code, name in sorted(provinces.items())],
        regions,
    )


def _rows_for(items: list[PemdaFunction]) -> list[dict[str, str]]:
    return [
        {"type": item.function, "realization_amount": f"{item.realization:.2f}"}
        for item in sorted(items, key=lambda item: (-item.realization, item.function))
    ]


def build_payload(
    parsed: ParsedWorkbook,
    regions_path: Path,
    aliases_path: Path,
    *,
    sha256: str,
    downloaded_at: str,
) -> tuple[dict[str, object], BuildResult]:
    provinces, regions = _reference(regions_path)
    matcher = RegionMatcher(provinces, regions, read_aliases(aliases_path))
    grouped: dict[str, list[PemdaFunction]] = {}
    unmatched: list[str] = []
    for item in parsed.functions:
        grouped.setdefault(item.djpk_code, []).append(item)
    mapped: dict[str, list[dict[str, str]]] = {}
    for code, items in grouped.items():
        sample = items[0]
        province_name = parsed.province_names.get(sample.djpk_province_code, "")
        province = matcher.province(sample.djpk_province_code, province_name)
        region = None if province is None else matcher.region(sample.djpk_province_code, province, sample.djpk_name)
        if region is None:
            unmatched.append(f"{code} {sample.djpk_name} ({province_name or 'provinsi tidak dikenal'})")
            continue
        mapped[region.kemendagri_code] = _rows_for(items)
    if unmatched:
        return {}, BuildResult(regions=0, unmatched=unmatched)
    # A zero realisation is a reported zero and stays in the row; an absent function is omitted.
    payload = {
        "year": YEAR,
        "source": {
            "publisher": "DJPK Kemenkeu",
            "title": "Realisasi belanja daerah menurut fungsi, 2024",
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build(
    workbook: Path,
    regions_path: Path,
    aliases_path: Path,
    output: Path,
    *,
    downloaded_at: str | None = None,
) -> BuildResult:
    parsed = parse_workbook(workbook)
    payload, result = build_payload(
        parsed,
        regions_path,
        aliases_path,
        sha256=sha256_file(workbook),
        downloaded_at=downloaded_at or datetime.fromtimestamp(workbook.stat().st_mtime, UTC).isoformat(),
    )
    if result.unmatched:
        return result
    write_json(output, payload)
    return result
