"""Hospitals (Kemenkes SIRS) and school counts (Kemendikdasmen referensi)."""

import hashlib
import json
import re
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key, read_aliases
from jaga_etl.population.parse import NATIONAL_TOTAL, NOTE, parse_rows, require_regions
from jaga_etl.web_data import write_json

HOSPITAL_URL = "https://sirs.kemkes.go.id/fo/home/rekap_rs_all?id=0"
COORDINATE_URL = "https://sirs.kemkes.go.id/fo/home/list_prop_noncovid?id=0"
# SIRS prints a name that is one official region, but not the current Kemendagri spelling.
SPELLING_ALIASES = {
    "toba samosir": "Kabupaten Toba",
    "kota baru": "Kabupaten Kotabaru",
    "mahakam hulu": "Kabupaten Mahakam Ulu",
    "pangkajene kepulauan": "Kabupaten Pangkajene dan Kepulauan",
}
HOSPITAL_NOTE = (
    "Daftar SIRS tidak memakai kode Kemendagri. Baris dihitung bila nama kabupaten/kota menunjuk "
    "tepat satu daerah di provinsi itu, termasuk empat ejaan yang merujuk satu daerah resmi. "
    "Bila nama yang sama dipakai kabupaten dan kota, koordinat pada peta SIRS dipakai hanya jika "
    "titiknya berada di dalam tepat satu dari dua batas resmi itu. Baris tanpa koordinat, di luar "
    "kedua batas, atau di dalam keduanya tidak dihitung dan tidak dijadikan nol. Ini jumlah "
    "fasilitas, bukan tempat tidur dan bukan kunjungan pasien."
)
DIKDAS_INDEX = "https://referensi.data.kemendikdasmen.go.id/pendidikan/dikdas"
DIKMEN_INDEX = "https://referensi.data.kemendikdasmen.go.id/pendidikan/dikmen"
UA = "JagaDaerah-ETL/0.1"
PROVINCE_LINK = re.compile(
    r'href="(https://referensi\.data\.kemendikdasmen\.go\.id/pendidikan/dik(?:das|men)/\d+/1)"[^>]*>\s*([^<]+?)\s*</a>'
)
SCHOOL_ROW = re.compile(
    r'<a href="[^"]+">([^<]+)</a></td>\s*<td>(\d+)</td>\s*<td>(\d+)</td>(?:\s*<td>(\d+)</td>)?',
    re.I,
)


@dataclass(frozen=True)
class BuildResult:
    regions: int
    hospitals_omitted: int
    schools_unmatched: list[str]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0:
        return
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        path.write_bytes(response.read())


def fetch_school_pages(cache: Path) -> None:
    for kind, index_url in (("dikdas", DIKDAS_INDEX), ("dikmen", DIKMEN_INDEX)):
        index_path = cache / f"{kind}-index.html"
        _download(index_url, index_path)
        html = index_path.read_text(encoding="utf-8", errors="replace")
        for url, _name in PROVINCE_LINK.findall(html):
            code = url.rstrip("/").split("/")[-2]
            _download(url, cache / kind / f"{code}.html")


def _provinces(regions: list[dict[str, object]], aliases_path: Path) -> dict[str, tuple[str, str]]:
    by_key = {
        name_key(str(region["province"]["name"])): (  # type: ignore[index]
            str(region["province"]["code"]),  # type: ignore[index]
            str(region["province"]["name"]),  # type: ignore[index]
        )
        for region in regions
    }
    by_code = {code: name for code, name in by_key.values()}
    for alias in read_aliases(aliases_path):
        if alias.kind != "province":
            continue
        official = by_code.get(alias.kemendagri_code)
        if official is not None:
            by_key[name_key(alias.djpk_name)] = (alias.kemendagri_code, official)
    return by_key


def _regions(regions: list[dict[str, object]]) -> dict[tuple[str, str], str]:
    found: dict[tuple[str, str], str] = {}
    for region in regions:
        province = str(region["province"]["code"])  # type: ignore[index]
        code = str(region["code"])
        key = name_key(str(region["name"]))
        found[(province, key)] = code
        # The region list itself abbreviates some names ("Kep."). Index the expanded form too.
        expanded = name_key(str(region["name"]).replace("Kep.", "Kepulauan"))
        if expanded != key and found.get((province, expanded)) in (None, code):
            found[(province, expanded)] = code
    return found


def ring_contains(ring: list[list[float]], lng: float, lat: float) -> bool:
    """Ray cast. A horizontal edge does not cross the test because the y comparison fails."""
    inside = False
    previous = len(ring) - 1
    for index, point in enumerate(ring):
        xi, yi = point
        xj, yj = ring[previous]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        previous = index
    return inside


def geometry_contains(geometry: dict[str, object], lng: float, lat: float) -> bool:
    coordinates = geometry["coordinates"]
    polygons = coordinates if geometry["type"] == "MultiPolygon" else [coordinates]
    for polygon in polygons:  # type: ignore[union-attr]
        if ring_contains(polygon[0], lng, lat) and not any(
            ring_contains(hole, lng, lat) for hole in polygon[1:]
        ):
            return True
    return False


def _coordinates(path: Path) -> dict[str, tuple[float, float]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    found: dict[str, tuple[float, float]] = {}
    for item in payload["rs"]:
        point = item.get("koordinat")
        if not isinstance(point, list) or len(point) < 2:
            continue
        found[str(item["kode"])] = (float(point[0]), float(point[1]))
    return found


def _boundaries(path: Path) -> dict[str, dict[str, object]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(feature["properties"]["code"]): feature["geometry"] for feature in payload["features"]}


def _count(counts: dict[str, dict[str, int]], code: str, jenis: str) -> None:
    bucket = counts[code]
    bucket["total"] += 1
    if jenis == "RSU":
        bucket["umum"] += 1
    elif jenis == "RSIA":
        bucket["ibu_anak"] += 1
    else:
        bucket["khusus"] += 1


def _hospitals(
    path: Path,
    by_province: dict[str, tuple[str, str]],
    by_region_key: dict[tuple[str, str], str],
    coordinates: dict[str, tuple[float, float]] | None = None,
    boundaries: dict[str, dict[str, object]] | None = None,
) -> tuple[dict[str, dict[str, int]], int]:
    """Count hospitals by kabupaten/kota name inside the named province.

    SIRS `kode` is not a Kemendagri code (11.73 in that file is not Kota Lhokseumawe).
    A row is kept when the name matches exactly one region. A name that matches both a
    kabupaten and a kota is kept only when its SIRS coordinate sits inside exactly one
    of those two official polygons.
    """
    payload = json.loads(path.read_text(encoding="utf-8"))
    counts: dict[str, dict[str, int]] = defaultdict(
        lambda: {"total": 0, "umum": 0, "ibu_anak": 0, "khusus": 0}
    )
    omitted = 0
    for row in payload["data"]:
        province_name = str(row["nama_prop"]).strip()
        province_key = name_key(province_name)
        # SIRS prints "Yogyakarta" for the province the DJPK alias calls DI Yogyakarta.
        if province_key == "yogyakarta":
            province_key = name_key("Provinsi DI Yogyakarta")
        province = by_province.get(province_key)
        if province is None:
            omitted += 1
            continue
        province_code = province[0]
        kab = SPELLING_ALIASES.get(str(row["kab"]).strip().lower(), str(row["kab"]).strip())
        keys = [_school_key(kab)]
        if not kab.lower().startswith(("kota ", "kabupaten ", "kab. ")):
            keys.extend(
                [
                    _school_key(f"Kabupaten {kab}"),
                    _school_key(f"Kota {kab}"),
                ]
            )
        hits = {
            by_region_key[item]
            for item in ((province_code, key) for key in keys)
            if item in by_region_key
        }
        if len(hits) == 1:
            _count(counts, next(iter(hits)), str(row["jenis"]))
            continue
        resolved = _resolve_coordinate(hits, str(row.get("kode", "")), coordinates, boundaries)
        if resolved is None:
            omitted += 1
            continue
        _count(counts, resolved, str(row["jenis"]))
    return counts, omitted


def _resolve_coordinate(
    hits: set[str],
    kode: str,
    coordinates: dict[str, tuple[float, float]] | None,
    boundaries: dict[str, dict[str, object]] | None,
) -> str | None:
    if len(hits) < 2 or coordinates is None or boundaries is None:
        return None
    point = coordinates.get(kode)
    if point is None:
        return None
    lat, lng = point
    inside = [
        code
        for code in hits
        if code in boundaries and geometry_contains(boundaries[code], lng, lat)
    ]
    if len(inside) != 1:
        return None
    return inside[0]


def _school_key(name: str) -> str:
    """Expand the abbreviations the referensi portal prints, then use the shared name key.

    Adm. and Kep. are the same words as Administrasi and Kepulauan. Padang Sidempuan is the
    portal's spelling of Padangsidimpuan.
    """
    expanded = (
        name.replace("Adm.", "Administrasi")
        .replace("Kep.", "Kepulauan")
        .replace("Padang Sidempuan", "Padangsidimpuan")
    )
    return name_key(expanded)


def _schools(
    cache: Path,
    by_province: dict[str, tuple[str, str]],
    by_region_key: dict[tuple[str, str], str],
) -> tuple[dict[str, dict[str, int]], list[str]]:
    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"sd": 0, "smp": 0, "sma": 0, "smk": 0})
    unmatched: list[str] = []
    folders = {"dikdas": ("sd", "smp"), "dikmen": ("sma", "smk")}
    for kind, (left, right) in folders.items():
        index = cache / f"{kind}-index.html"
        if not index.exists():
            continue
        pages = PROVINCE_LINK.findall(index.read_text(encoding="utf-8", errors="replace"))
        for url, province_name in pages:
            if name_key(province_name) == "luarnegeri":
                continue
            province = by_province.get(name_key(province_name))
            code = url.rstrip("/").split("/")[-2]
            page = cache / kind / f"{code}.html"
            if province is None or not page.exists():
                unmatched.append(province_name.strip())
                continue
            province_code = province[0]
            for name, first, second, _total in SCHOOL_ROW.findall(page.read_text(encoding="utf-8", errors="replace")):
                region = by_region_key.get((province_code, _school_key(name)))
                if region is None:
                    unmatched.append(f"{province_name.strip()} / {name.strip()}")
                    continue
                bucket = counts[region]
                bucket[left] += int(first)
                bucket[right] += int(second)
    return counts, sorted(set(unmatched))


def build(
    hospital_path: Path,
    school_cache: Path,
    regions_path: Path,
    aliases_path: Path,
    output_path: Path,
    population_path: Path,
) -> BuildResult:
    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    by_region_key = _regions(regions)
    hospitals, omitted = _hospitals(
        hospital_path, _provinces(regions, aliases_path), by_region_key
    )
    schools, unmatched = _schools(school_cache, _provinces(regions, aliases_path), by_region_key)
    if unmatched:
        return BuildResult(0, omitted, unmatched)
    codes = sorted(str(region["code"]) for region in regions)
    population = require_regions(parse_rows(population_path.read_text(encoding="utf-8")), regions)
    retrieved = datetime.fromtimestamp(hospital_path.stat().st_mtime, UTC).isoformat()
    payload = {
        "hospitals": {
            "source": {
                "publisher": "Kemenkes",
                "title": "Daftar rumah sakit nasional (SIRS)",
                "url": HOSPITAL_URL,
                "sha256": sha256_file(hospital_path),
                "retrieved_at": retrieved,
            },
            "omitted": omitted,
            "note": HOSPITAL_NOTE,
        },
        "schools": {
            "source": {
                "publisher": "Kemendikdasmen",
                "title": "Jumlah satuan pendidikan per kabupaten/kota",
                "url": DIKDAS_INDEX,
                "sha256": sha256_file(school_cache / "dikdas-index.html"),
                "retrieved_at": datetime.fromtimestamp(
                    (school_cache / "dikdas-index.html").stat().st_mtime, UTC
                ).isoformat(),
            },
            "note": (
                "Jumlah satuan pendidikan pada portal referensi Kemendikdasmen saat berkas ini diambil: "
                "SD dan SMP dari halaman dikdas, SMA dan SMK dari halaman dikmen. SLB tercantum "
                "di halaman dikmen dan tidak dijumlahkan di sini. Portal itu tidak "
                "mencetak tahun ajaran. Ini jumlah sekolah, bukan jumlah murid. Nama yang tidak cocok "
                "dengan satu kabupaten/kota tidak dihitung."
            ),
        },
        "population": {
            "source": {
                "publisher": "Ditjen Dukcapil, Kementerian Dalam Negeri",
                "title": "Data Kependudukan Semester II Tahun 2024 (31 Desember 2024)",
                "url": "https://github.com/cahyadsn/wilayah/blob/master/db/wilayah_penduduk.sql",
                "sha256": sha256_file(population_path),
                "retrieved_at": datetime.fromtimestamp(population_path.stat().st_mtime, UTC).isoformat(),
            },
            "as_of": "2024-12-31",
            "national_total": NATIONAL_TOTAL,
            "note": NOTE,
        },
        "regions": {
            code: {
                "hospitals": hospitals.get(code),
                "schools": schools.get(code),
                "population": {
                    "total": population[code].total,
                    "male": population[code].male,
                    "female": population[code].female,
                },
            }
            for code in codes
        },
    }
    write_json(output_path, payload)
    return BuildResult(len(codes), omitted, [])


def coordinate_source(path: Path) -> dict[str, str]:
    return {
        "publisher": "Kemenkes",
        "title": "Koordinat rumah sakit pada peta SIRS",
        "url": COORDINATE_URL,
        "sha256": sha256_file(path),
        "retrieved_at": datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(),
    }


def refresh_hospitals(
    hospital_path: Path,
    coordinates_path: Path,
    boundaries_path: Path,
    regions_path: Path,
    aliases_path: Path,
    output_path: Path,
) -> int:
    """Replace hospital counts in an existing artifact. Schools and population stay as published."""
    regions = json.loads(regions_path.read_text(encoding="utf-8"))
    by_region_key = _regions(regions)
    counts, omitted = _hospitals(
        hospital_path,
        _provinces(regions, aliases_path),
        by_region_key,
        _coordinates(coordinates_path),
        _boundaries(boundaries_path),
    )
    existing = json.loads(output_path.read_text(encoding="utf-8"))
    existing["hospitals"]["omitted"] = omitted
    existing["hospitals"]["note"] = HOSPITAL_NOTE
    existing["hospitals"]["coordinates"] = coordinate_source(coordinates_path)
    for code, record in existing["regions"].items():
        record["hospitals"] = counts.get(code)
    write_json(output_path, existing)
    return omitted
