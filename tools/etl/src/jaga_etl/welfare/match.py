"""Match a BPS place name to one Kemendagri region inside its province.

BPS prints names, not Kemendagri codes. A match has to be unique after spelling is normalised.
Anything still ambiguous or unknown stays unmatched and is reported; it is never guessed.
"""

from collections import defaultdict

# The printed name and the Kemendagri name differ by a known spelling or a rename.
# Each target is the official name's stem, checked again against regions.json.
SOURCE_ALIASES = {
    "bangka belitung": "kepulauan bangka belitung",
    "dki jakarta": "daerah khusus ibukota jakarta",
    "di yogyakarta": "daerah istimewa yogyakarta",
    "d i yogyakarta": "daerah istimewa yogyakarta",
    "kota baru": "kotabaru",
    "bireun": "bireuen",
    "toba samosir": "toba",
    "padang sidempuan": "padangsidimpuan",
    "kep anambas": "kepulauan anambas",
    "siau tagulandang biaro": "kep siau tagulandang biaro",
    "kepulauan sitaro": "kep siau tagulandang biaro",
    "makasar": "makassar",
    "maluku tenggara barat": "kepulauan tanimbar",
    # Kabupaten Mamuju Utara was renamed Kabupaten Pasangkayu; BPS still prints the old name.
    "mamuju utara": "pasangkayu",
}


def _compact(value: str) -> str:
    return "".join(ch for ch in value.lower() if ch.isalnum())


def province_key(name: str) -> str:
    cleaned = " ".join(name.lower().replace(".", " ").split())
    cleaned = SOURCE_ALIASES.get(cleaned, cleaned)
    return _compact(cleaned)


def region_key(name: str) -> tuple[str, str]:
    cleaned = " ".join(name.lower().replace(".", " ").replace("-", " ").split())
    cleaned = SOURCE_ALIASES.get(cleaned, cleaned)
    kind = "kabupaten"
    for prefix, parsed in (
        ("kabupaten administrasi ", "kabupaten"),
        ("kota administrasi ", "kota"),
        ("kabupaten ", "kabupaten"),
        ("kab ", "kabupaten"),
        ("kota ", "kota"),
    ):
        if cleaned.startswith(prefix):
            kind = parsed
            cleaned = cleaned[len(prefix) :]
            break
    cleaned = SOURCE_ALIASES.get(cleaned, cleaned)
    return kind, _compact(cleaned)


def index_regions(regions: list[dict[str, object]]) -> tuple[dict[str, str], dict[str, dict[tuple[str, str], str]]]:
    provinces: dict[str, str] = {}
    places: dict[str, dict[tuple[str, str], str]] = defaultdict(dict)
    for region in regions:
        province = region["province"]
        if not isinstance(province, dict):
            raise ValueError("regions.json is missing a province object")
        province_code = province["code"]
        province_name = province["name"]
        code = region["code"]
        name = region["name"]
        if not isinstance(province_code, str) or not isinstance(province_name, str):
            raise ValueError("regions.json has a province without a code and name")
        if not isinstance(code, str) or not isinstance(name, str):
            raise ValueError("regions.json has a region without a code and name")
        provinces[province_key(province_name)] = province_code
        key = region_key(name)
        existing = places[province_code].get(key)
        if existing is not None and existing != code:
            raise ValueError(f"Two regions share the name key {key}: {existing} and {code}")
        places[province_code][key] = code
    return provinces, places


def match_place(
    provinces: dict[str, str],
    places: dict[str, dict[tuple[str, str], str]],
    province_name: str,
    place_name: str,
) -> str | None:
    province_code = provinces.get(province_key(province_name))
    if province_code is None:
        return None
    return places[province_code].get(region_key(place_name))
