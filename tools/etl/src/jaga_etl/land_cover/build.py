"""Match KLHK province names to Kemendagri codes and write the land-cover artifact."""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key, read_aliases
from jaga_etl.land_cover.parse import hectares_of, parse_rekap
from jaga_etl.web_data import write_json

SOURCE_URL = "https://statistik.menlhk.go.id/sisklhkX/data_statistik/pktl/table1_0"
YEAR = 2023
LABELS = {
    "hutan_primer": "Hutan primer",
    "hutan_sekunder": "Hutan sekunder",
    "hutan_tanaman": "Hutan tanaman",
    "bukan_hutan": "Bukan hutan",
}
NOTE = (
    "Luas penutupan lahan 2023 tingkat provinsi, dalam hektare, dari rekapitulasi PKTL KLHK. "
    "Angka aslinya dalam ribu hektare dan dikalikan 1.000 di sini. Empat kelas ini yang dipisah "
    "tabel nasional: hutan primer, hutan sekunder, hutan tanaman, dan bukan hutan. Mangrove, "
    "sawah, perkebunan, dan permukiman tidak dipisah, dan ini bukan daftar spesies atau data "
    "kabupaten/kota. Katalog Satu Data Indonesia 2014–2018 tidak dipakai: berkasnya menunjuk ke "
    "alamat internal dan menggabungkan Kalimantan Timur dengan Kalimantan Utara. Host "
    "statistik.menlhk.go.id sudah tidak terurai; checksum di bawah adalah tabel yang tersimpan."
)


@dataclass(frozen=True)
class BuildResult:
    provinces: int
    unmatched: list[str]


def _alias_codes(path: Path) -> dict[str, str]:
    """Reviewed DJPK abbreviations (DKI, DI Yogyakarta) apply to the same province names here."""
    found: dict[str, str] = {}
    for alias in read_aliases(path):
        if alias.kind != "province":
            continue
        key = name_key(alias.djpk_name)
        previous = found.get(key)
        if previous is not None and previous != alias.kemendagri_code:
            raise ValueError(f"alias provinsi bentrok untuk {alias.djpk_name}")
        found[key] = alias.kemendagri_code
    return found


def _provinces(path: Path) -> dict[str, tuple[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    found: dict[str, tuple[str, str]] = {}
    for region in payload:
        province = region["province"]
        found[name_key(province["name"])] = (province["code"], province["name"])
    return found


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_payload(
    text: str,
    regions_path: Path,
    aliases_path: Path,
    *,
    sha256: str,
    retrieved_at: str,
) -> tuple[dict[str, object], BuildResult]:
    by_key = _provinces(regions_path)
    by_code = {code: name for code, name in by_key.values()}
    aliases = _alias_codes(aliases_path)
    matched: dict[str, dict[str, object]] = {}
    unmatched: list[str] = []
    for cover in parse_rekap(text):
        province = by_key.get(name_key(cover.name))
        if province is None:
            code = aliases.get(name_key(cover.name))
            official = None if code is None else by_code.get(code)
            province = None if official is None or code is None else (code, official)
        if province is None:
            unmatched.append(cover.name)
            continue
        code, name = province
        matched[code] = {
            "name": name,
            "rows": [
                {"class": class_id, "hectares": hectares}
                for class_id, hectares in hectares_of(cover).items()
            ],
        }
    if unmatched:
        return {}, BuildResult(provinces=0, unmatched=unmatched)
    payload = {
        "year": YEAR,
        "unit": "ha",
        "level": "provinsi",
        "source": {
            "publisher": "KLHK",
            "title": "Rekapitulasi luas penutupan lahan di dalam dan di luar kawasan hutan per provinsi tahun 2023",
            "url": SOURCE_URL,
            "sha256": sha256,
            "retrieved_at": retrieved_at,
        },
        "note": NOTE,
        "labels": LABELS,
        "provinces": dict(sorted(matched.items())),
    }
    return payload, BuildResult(provinces=len(matched), unmatched=[])


def build(table_path: Path, regions_path: Path, aliases_path: Path, output_path: Path) -> BuildResult:
    text = table_path.read_text(encoding="utf-8")
    retrieved = datetime.fromtimestamp(table_path.stat().st_mtime, UTC).isoformat()
    payload, result = build_payload(
        text,
        regions_path,
        aliases_path,
        sha256=sha256_file(table_path),
        retrieved_at=retrieved,
    )
    if result.unmatched:
        return result
    write_json(output_path, payload)
    return result
