"""Turn the three BPS books into the profile welfare artifact."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pypdf import PdfReader

from jaga_etl.welfare.match import index_regions, match_place
from jaga_etl.welfare.parse import (
    WelfareParseError,
    parse_development,
    parse_output,
    parse_poverty,
)
from jaga_etl.web_data import write_json

POVERTY_PAGE = "https://www.bps.go.id/id/publication/2025/11/28/f7534097ff9c717e794cd6e1/data-dan-informasi-kemiskinan-kabupaten--kota-tahun-2025.html"
OUTPUT_PAGE = "https://www.bps.go.id/id/publication/2026/06/10/234d5061d35a199c70e77766/produk-domestik-regional-bruto-kabupaten-kota-di-indonesia-2021-2025.html"
DEVELOPMENT_PAGE = "https://www.bps.go.id/id/publication/2026/04/24/f96755ab0e48765d028c0462/indeks-pembangunan-manusia-2025.html"
SURVEY_MARK = "Susenas Modul Konsumsi dan Pengeluaran Maret 2025"

POVERTY_NOTE = (
    "Persentase dan jumlah penduduk miskin kabupaten/kota tahun 2025, Badan Pusat Statistik, "
    "Tabel 2.1 buku Data dan Informasi Kemiskinan Kabupaten/Kota 2025. "
    "BPS menghitungnya dari Susenas Maret 2025. Jumlah ditulis dalam ribu jiwa, sama seperti tabel itu, "
    "bukan hasil bagi dengan catatan Dukcapil. Garis kemiskinan adalah batas pengeluaran per orang per bulan. "
    "Wilayah yang tidak ada di tabel dikosongkan, tidak diisi nol."
)
OUTPUT_NOTE = (
    "PDRB per kapita atas dasar harga berlaku tahun 2025, Badan Pusat Statistik, dalam ribu rupiah. "
    "Ini hasil ekonomi daerah dibagi jumlah penduduk, bukan gaji dan bukan penghasilan rumah tangga. "
    "BPS menandai angka 2025 sebagai angka sangat sementara. "
    "Sel kosong berarti tabel itu tidak memuat angka 2025 yang bisa dibaca untuk daerah itu."
)
DEVELOPMENT_NOTE = (
    "Indeks Pembangunan Manusia 2025 dan pengeluaran riil per kapita yang disesuaikan, "
    "Badan Pusat Statistik, Lampiran 2 buku Indeks Pembangunan Manusia 2025. "
    "Pengeluaran itu komponen IPM, dalam ribu rupiah per orang per tahun, bukan gaji. "
    "Wilayah yang tidak ada di lampiran dikosongkan, tidak diisi nol."
)

# Rows read straight off the printed tables, so a shifted column fails the build.
SPOT_CHECKS = {
    "11.01": {
        "poverty": ("25.39", "9.89", 538174),
        "output": 32867,
        "development": ("72.79", 9573),
    },
    "11.09": {
        "poverty": ("15.58", "15.52", 586505),
        "output": 34332,
        "development": ("71.94", 8555),
    },
    "12.11": {"poverty": ("20.05", "6.98", 521738)},
    "32.73": {
        "poverty": ("99.12", "3.78", 644417),
        "output": 158495,
        "development": ("84.66", 19280),
    },
    "34.01": {"output": 40069},
}


@dataclass(frozen=True)
class BuildResult:
    regions: int
    poverty: int
    output: int
    development: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _text(path: Path) -> str:
    reader = PdfReader(path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _source(path: Path, title: str, page: str, retrieved_at: str) -> dict[str, str]:
    return {
        "publisher": "Badan Pusat Statistik",
        "title": title,
        "url": page,
        "sha256": _sha256(path),
        "retrieved_at": retrieved_at,
    }


def build(
    poverty_pdf: Path,
    output_pdf: Path,
    development_pdf: Path,
    regions_path: Path,
    dest: Path,
) -> BuildResult:
    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    if not isinstance(regions, list):
        raise WelfareParseError("regions.json must be a list")
    provinces, places = index_regions(regions)
    codes = [region["code"] for region in regions if isinstance(region.get("code"), str)]
    poverty_text = _text(poverty_pdf)
    if SURVEY_MARK not in " ".join(poverty_text.split()):
        raise WelfareParseError("Buku kemiskinan tidak lagi menyebut Susenas Maret 2025.")

    poverty: dict[str, dict[str, object]] = {}
    output: dict[str, int] = {}
    development: dict[str, dict[str, object]] = {}
    missed: list[str] = []

    def take(series: str, province_name: str, place_name: str) -> str | None:
        code = match_place(provinces, places, province_name, place_name)
        if code is None:
            missed.append(f"{series}: {province_name} / {place_name}")
        return code

    for row in parse_poverty(poverty_text, set(provinces)):
        code = take("kemiskinan", row.province_name, row.name)
        if code is None:
            continue
        if code in poverty:
            raise WelfareParseError(f"Kemiskinan menyebut {code} dua kali.")
        poverty[code] = {
            "people_thousands": row.people_thousands,
            "percent": row.percent,
            "line_rupiah": row.line_rupiah,
        }
    for row in parse_output(_text(output_pdf)):
        if row.per_person_thousands is None:
            continue
        code = take("pdrb", row.province_name, row.name)
        if code is None:
            continue
        if code in output:
            raise WelfareParseError(f"PDRB per kapita menyebut {code} dua kali.")
        output[code] = row.per_person_thousands
    for row in parse_development(_text(development_pdf)):
        code = take("ipm", row.province_name, row.name)
        if code is None:
            continue
        if code in development:
            raise WelfareParseError(f"IPM menyebut {code} dua kali.")
        development[code] = {
            "index": row.index,
            "adjusted_spending_thousands": row.adjusted_spending_thousands,
        }

    for code, expected in SPOT_CHECKS.items():
        poverty_expected = expected.get("poverty")
        if poverty_expected is not None and poverty.get(code) != {
            "people_thousands": poverty_expected[0],
            "percent": poverty_expected[1],
            "line_rupiah": poverty_expected[2],
        }:
            raise WelfareParseError(f"Cek kemiskinan {code} tidak sama dengan tabel: {poverty.get(code)}")
        if "output" in expected and output.get(code) != expected["output"]:
            raise WelfareParseError(f"Cek PDRB {code} tidak sama dengan tabel: {output.get(code)}")
        development_expected = expected.get("development")
        if development_expected is not None and development.get(code) != {
            "index": development_expected[0],
            "adjusted_spending_thousands": development_expected[1],
        }:
            raise WelfareParseError(f"Cek IPM {code} tidak sama dengan tabel: {development.get(code)}")

    if len(poverty) < 514 or len(development) < 514 or len(output) < 488:
        missing_output = sorted(
            region["province"]["code"]
            for region in regions
            if isinstance(region.get("code"), str) and region["code"] not in output
        )
        detail = "\n".join(missed[:40])
        raise WelfareParseError(
            f"Cakupan terlalu rendah: kemiskinan {len(poverty)}, IPM {len(development)}, PDRB {len(output)}.\n"
            f"provinsi tanpa PDRB 2025: {missing_output[:80]}\n{detail}"
        )

    retrieved_at = datetime.now(UTC).isoformat()
    payload = {
        "poverty": {
            "year": 2025,
            "source": _source(
                poverty_pdf,
                "Data dan Informasi Kemiskinan Kabupaten/Kota Tahun 2025",
                POVERTY_PAGE,
                retrieved_at,
            ),
            "note": POVERTY_NOTE,
        },
        "output": {
            "year": 2025,
            "source": _source(
                output_pdf,
                "Produk Domestik Regional Bruto Kabupaten/Kota di Indonesia 2021–2025",
                OUTPUT_PAGE,
                retrieved_at,
            ),
            "note": OUTPUT_NOTE,
        },
        "development": {
            "year": 2025,
            "source": _source(
                development_pdf,
                "Indeks Pembangunan Manusia 2025",
                DEVELOPMENT_PAGE,
                retrieved_at,
            ),
            "note": DEVELOPMENT_NOTE,
        },
        "regions": {
            code: {
                "poverty": poverty.get(code),
                "output_per_person_thousands": output.get(code),
                "development": development.get(code),
            }
            for code in codes
        },
    }
    write_json(dest, payload)
    if missed:
        print("unmatched", len(missed))
        for item in missed:
            print(item)
    return BuildResult(len(codes), len(poverty), len(output), len(development))
