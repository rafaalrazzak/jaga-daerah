"""Parse one coded national population table and refuse it unless it is internally consistent.

The file is `db/wilayah_penduduk.sql` from cahyadsn/wilayah (MIT). Its header says the figures follow
Ditjen Dukcapil's Data Kependudukan for 31 December 2024. Rows are matched by Kemendagri code, never
by name alone: a code whose name differs from the region list is rejected.
"""

import re
from dataclasses import dataclass

ROW = re.compile(
    r"\('(?P<code>[0-9.]+)'\s*,\s*'(?P<name>(?:[^'\\]|'')*)'\s*,\s*'(?P<male>\d+)'\s*,\s*'(?P<female>\d+)'\s*,\s*'(?P<total>\d+)'\)"
)
PROVINCE = re.compile(r"\d{2}")
REGION = re.compile(r"\d{2}\.\d{2}")
# Ditjen Dukcapil, Data Kependudukan Semester II 2024, as stated by the Director General.
NATIONAL_TOTAL = 284_973_643
# Official kabupaten/kota books that cite the same Dukcapil release. Male, female, total.
SPOT_CHECKS = {
    "12.11": (166_297, 167_038, 333_335),  # Kabupaten Dairi
    "35.25": (667_540, 659_957, 1_327_497),  # Kabupaten Gresik
    "32.77": (292_434, 289_560, 581_994),  # Kota Cimahi
}

NOTE = (
    "Jumlah jiwa pada Data Konsolidasi Bersih Ditjen Dukcapil per 31 Desember 2024. "
    "Ini catatan administrasi kependudukan, bukan hasil Sensus atau proyeksi BPS. "
    "BPS menerbitkan penduduk kabupaten/kota sebagai tabel terpisah tiap provinsi, dan katalog "
    "data.go.id tidak menyediakan berkas unduhan. Angka di sini berasal dari satu tabel nasional "
    "berkode wilayah (cahyadsn/wilayah, berkas db/wilayah_penduduk.sql). Jumlah nasionalnya "
    "284.973.643 jiwa, sama dengan rilis Dukcapil untuk semester itu. "
    "Kabupaten atau kota yang tidak ada di tabel dikosongkan, tidak diisi nol."
)


@dataclass(frozen=True)
class PopulationRow:
    code: str
    name: str
    male: int
    female: int
    total: int


class PopulationError(ValueError):
    pass


def parse_rows(text: str) -> list[PopulationRow]:
    rows = [
        PopulationRow(
            code=match.group("code"),
            name=match.group("name").replace("''", "'"),
            male=int(match.group("male")),
            female=int(match.group("female")),
            total=int(match.group("total")),
        )
        for match in ROW.finditer(text)
    ]
    if not rows:
        raise PopulationError("population file has no rows")
    return rows


def _same_name(left: str, right: str) -> bool:
    """The source file sometimes doubles a space, or writes Kabupaten as Kab. Same code, same place."""

    def norm(value: str) -> str:
        words = value.split()
        if words[:1] == ["Kab"]:
            words[0] = "Kabupaten"
        return " ".join(words)

    return norm(left) == norm(right)


def require_regions(rows: list[PopulationRow], regions: list[dict[str, object]]) -> dict[str, PopulationRow]:
    """Return kabupaten/kota rows after the national, province, and name checks pass."""
    by_code: dict[str, PopulationRow] = {}
    for row in rows:
        if row.male + row.female != row.total:
            raise PopulationError(f"{row.code} male+female is {row.male + row.female}, not {row.total}")
        if row.code in by_code:
            raise PopulationError(f"duplicate population code {row.code}")
        by_code[row.code] = row

    national = by_code.get("0")
    if national is None or national.total != NATIONAL_TOTAL:
        found = None if national is None else national.total
        raise PopulationError(f"national total is {found}, expected {NATIONAL_TOTAL}")

    provinces = [row for row in rows if PROVINCE.fullmatch(row.code)]
    kabupaten = [row for row in rows if REGION.fullmatch(row.code)]
    if sum(row.total for row in provinces) != national.total:
        raise PopulationError("province totals do not add up to the national total")
    if sum(row.male for row in provinces) != national.male or sum(row.female for row in provinces) != national.female:
        raise PopulationError("province sex totals do not add up to the national sex totals")

    for province in provinces:
        children = [row for row in kabupaten if row.code.startswith(f"{province.code}.")]
        if sum(row.total for row in children) != province.total:
            raise PopulationError(f"kabupaten/kota in {province.code} do not add up to the province total")
        if sum(row.male for row in children) != province.male or sum(row.female for row in children) != province.female:
            raise PopulationError(f"sex totals in {province.code} do not add up to the province")

    expected = {str(region["code"]): str(region["name"]) for region in regions}
    found = {row.code: row for row in kabupaten}
    missing = sorted(set(expected) - set(found))
    extra = sorted(set(found) - set(expected))
    if missing or extra:
        raise PopulationError(f"region coverage missing={missing[:8]} extra={extra[:8]}")
    mismatches = [code for code, name in expected.items() if not _same_name(found[code].name, name)]
    if mismatches:
        sample = ", ".join(f"{code}: {found[code].name!r} != {expected[code]!r}" for code in mismatches[:5])
        raise PopulationError(f"population names differ from the region list: {sample}")

    for code, (male, female, total) in SPOT_CHECKS.items():
        row = found[code]
        if (row.male, row.female, row.total) != (male, female, total):
            raise PopulationError(f"spot check failed for {code}")
    return found
