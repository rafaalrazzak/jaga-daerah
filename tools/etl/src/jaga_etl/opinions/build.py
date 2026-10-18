"""Match BPK opinions to Kemendagri regions and write the profile artifact."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.opinions.parse import OpinionParseError, parse_opinions
from jaga_etl.web_data import write_json

PAGE_URL = "https://data.bpk.go.id/Opini/opinilkpd"
DOWNLOAD_URL = "https://data.bpk.go.id/Opini/download_csv/D15C3FD8-5135-42E1-81DF-888A70CB7891"
LABELS = {
    "WTP": "Wajar tanpa pengecualian",
    "WDP": "Wajar dengan pengecualian",
    "TW": "Tidak wajar",
    "TMP": "Tidak menyatakan pendapat",
}
NOTE = (
    "Opini Badan Pemeriksa Keuangan atas laporan keuangan pemerintah daerah, dari unduhan Portal Data BPK. "
    "Wajar tanpa pengecualian berarti BPK menilai laporan itu disajikan secara wajar dalam semua hal yang material. "
    "Ini bukan penilaian atas pejabat, bukan pernyataan bahwa programnya tepat sasaran, dan bukan temuan korupsi. "
    "Sel kosong pada tahun lama berarti BPK tidak menerbitkan opini untuk tahun itu. "
    "Enam kabupaten dan kota administrasi DKI Jakarta tidak menyusun laporan sendiri; halaman mereka memakai opini Provinsi DKI Jakarta dan menyebutnya sebagai angka provinsi."
)


@dataclass(frozen=True)
class BuildResult:
    regions: int
    provinces: int


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _region_codes(path: Path) -> tuple[set[str], set[str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    codes = {region["code"] for region in payload}
    provinces = {region["province"]["code"] for region in payload}
    return codes, provinces


def build_payload(
    text: str,
    regions_path: Path,
    *,
    sha256: str,
    retrieved_at: str,
) -> tuple[dict[str, object], BuildResult]:
    parsed_regions, parsed_provinces = parse_opinions(text)
    region_codes, province_codes = _region_codes(regions_path)
    if province_codes != set(parsed_provinces):
        missing = sorted(province_codes - set(parsed_provinces))
        extra = sorted(set(parsed_provinces) - province_codes)
        raise OpinionParseError(f"kode provinsi tidak lengkap: hilang {missing}, lebih {extra}")

    administrative = {code for code in region_codes if code.startswith("31.")}
    autonomous = region_codes - administrative
    missing_regions = sorted(autonomous - set(parsed_regions))
    unexpected = sorted(set(parsed_regions) - autonomous)
    if missing_regions or unexpected:
        raise OpinionParseError(
            f"kecocokan kabupaten/kota gagal: hilang {missing_regions[:8]}, tidak dikenal {unexpected[:8]}"
        )
    if administrative & set(parsed_regions):
        raise OpinionParseError("kabupaten/kota administrasi DKI tidak boleh punya baris opini sendiri")

    def series(item: tuple[tuple[int, str], ...]) -> list[dict[str, object]]:
        return [{"year": year, "opinion": opinion} for year, opinion in item]

    payload: dict[str, object] = {
        "latest_year": 2024,
        "source": {
            "publisher": "Badan Pemeriksa Keuangan",
            "title": "Daftar Opini Laporan Keuangan Pemerintah Daerah",
            "url": DOWNLOAD_URL,
            "page": PAGE_URL,
            "sha256": sha256,
            "retrieved_at": retrieved_at,
        },
        "labels": LABELS,
        "note": NOTE,
        "provinces": {
            code: {"years": series(parsed_provinces[code].years)} for code in sorted(parsed_provinces)
        },
        "regions": {code: {"years": series(parsed_regions[code].years)} for code in sorted(parsed_regions)},
    }
    return payload, BuildResult(len(parsed_regions), len(parsed_provinces))


def build(csv_path: Path, regions_path: Path, output_path: Path) -> BuildResult:
    text = csv_path.read_text(encoding="utf-8-sig")
    retrieved_at = datetime.fromtimestamp(csv_path.stat().st_mtime, UTC).isoformat()
    payload, result = build_payload(
        text,
        regions_path,
        sha256=sha256_file(csv_path),
        retrieved_at=retrieved_at,
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(output_path, payload)
    return result
