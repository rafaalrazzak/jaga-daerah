"""Pinned boundary source: cahyadsn/wilayah_boundaries (MIT), Kepmendagri No. 300.2.2-2430/2025 codes.

Each SQL file holds `('code','name',lat,lng,'[[[lat,lng],...]]')` tuples. Files are parsed as text and
never executed. Coordinates are [latitude, longitude] pairs nested as polygon or multipolygon rings.
"""

REPOSITORY = "cahyadsn/wilayah_boundaries"
COMMIT = "28230eca6e787bac229db56825bd5b1843662c96"
LICENSE = "MIT"
RAW_BASE = f"https://raw.githubusercontent.com/{REPOSITORY}/{COMMIT}/db"

# Kemendagri province codes (38) and the source's grouped province files (1–8).
PROVINCE_CODES = (
    "11", "12", "13", "14", "15", "16", "17", "18", "19", "21",
    "31", "32", "33", "34", "35", "36", "51", "52", "53", "61",
    "62", "63", "64", "65", "71", "72", "73", "74", "75", "76",
    "81", "82", "91", "92", "93", "94", "95", "96",
)  # fmt: skip
PROVINCE_FILE_NUMBERS = tuple(range(1, 9))


def kabupaten_files() -> list[tuple[str, str]]:
    return [
        (f"kab_{code}.sql", f"{RAW_BASE}/kab/wilayah_boundaries_kab_{code}.sql") for code in PROVINCE_CODES
    ]


def province_files() -> list[tuple[str, str]]:
    return [
        (f"prov_{number}.sql", f"{RAW_BASE}/prov/wilayah_boundaries_prov_{number}.sql")
        for number in PROVINCE_FILE_NUMBERS
    ]
