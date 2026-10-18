"""Map English Wikipedia names to Kemendagri codes and match people against KPU candidates."""

import re
from difflib import SequenceMatcher

from jaga_etl.facts.djpk.mapping import name_key

# English Wikipedia province page names → Kemendagri province codes (38 provinces, 2025).
PROVINCE_CODES = {
    "Aceh": "11", "North Sumatra": "12", "West Sumatra": "13", "Riau": "14", "Jambi": "15",
    "South Sumatra": "16", "Bengkulu": "17", "Lampung": "18", "Bangka Belitung Islands": "19",
    "Riau Islands": "21", "Jakarta": "31", "West Java": "32", "Central Java": "33",
    "Special Region of Yogyakarta": "34", "East Java": "35", "Banten": "36", "Bali": "51",
    "West Nusa Tenggara": "52", "East Nusa Tenggara": "53", "West Kalimantan": "61",
    "Central Kalimantan": "62", "South Kalimantan": "63", "East Kalimantan": "64",
    "North Kalimantan": "65", "North Sulawesi": "71", "Central Sulawesi": "72",
    "South Sulawesi": "73", "Southeast Sulawesi": "74", "Gorontalo": "75", "West Sulawesi": "76",
    "Maluku": "81", "North Maluku": "82", "Papua": "91", "West Papua": "92", "South Papua": "93",
    "Central Papua": "94", "Highland Papua": "95", "Southwest Papua": "96",
}  # fmt: skip

DIRECTIONS = {
    "north": "Utara", "south": "Selatan", "east": "Timur", "west": "Barat", "central": "Tengah",
    "southwest": "Barat Daya", "southeast": "Tenggara", "northwest": "Barat Laut",
    "northeast": "Timur Laut",
}  # fmt: skip

# Party names as English Wikipedia writes them → the names used in Indonesia.
PARTIES = {
    "gerindra": "Partai Gerindra", "golkar": "Partai Golkar", "nasdem": "Partai NasDem",
    "national awakening": "PKB", "democratic party of struggle": "PDI Perjuangan",
    "national mandate": "PAN", "prosperous justice": "PKS", "united development": "PPP",
    "democratic party": "Partai Demokrat", "solidarity": "PSI", "perindo": "Partai Perindo",
    "labour": "Partai Buruh", "hanura": "Partai Hanura", "people's conscience": "Partai Hanura",
    "crescent star": "PBB", "gelora": "Partai Gelora", "garuda": "Partai Garuda",
    "ummah": "Partai Ummat", "aceh party": "Partai Aceh", "independent": "Nonpartai",
    "nanggroe aceh": "Partai Nanggroe Aceh", "indonesian justice and unity": "PKPI",
}  # fmt: skip


def party_name(english: str | None) -> str | None:
    if english is None:
        return None
    lowered = english.lower()
    for key, name in PARTIES.items():
        if key in lowered:
            return name
    return re.sub(r"\s*\([^)]*\)", "", english).strip() or None


def _translate(name: str) -> str:
    """"West Bandung" → "Bandung Barat"; "North Central Timor" → "Timor Tengah Utara";
    "Seribu Islands" → "Kepulauan Seribu"."""
    words = name.split()
    leading: list[str] = []
    while words and words[0].lower() in DIRECTIONS:
        leading.append(DIRECTIONS[words.pop(0).lower()])
    if words and words[-1].lower() == "islands":
        words = ["Kepulauan", *words[:-1]]
    return " ".join([*words, *reversed(leading)])


def candidate_names(wiki_region: str) -> list[str]:
    name = re.sub(r"\s+", " ", wiki_region).strip().replace(" Administrative ", " ")
    for suffix, kinds in ((" Regency", ("Kabupaten",)), (" City", ("Kota",))):
        if name.endswith(suffix):
            base = name[: -len(suffix)]
            return [f"{kind} {variant}" for kind in kinds for variant in dict.fromkeys([_translate(base), base])]
    # Jakarta's administrative cities are written without a suffix ("South Jakarta").
    return [f"{kind} {variant}" for kind in ("Kota", "Kabupaten") for variant in dict.fromkeys([_translate(name), name])]


def match_region(names: list[str], province_regions: dict[str, str], aliases: dict[str, str]) -> str | None:
    """Try each Wikipedia name in order (link target first); province_regions is name_key → code."""
    for wiki_region in names:
        if (alias := aliases.get(name_key(wiki_region))) is not None:
            return alias
        for candidate in candidate_names(wiki_region):
            if (code := province_regions.get(name_key(candidate))) is not None:
                return code
    return None


TITLE_TOKENS = {
    "h", "hj", "dr", "drs", "dra", "ir", "prof", "kh", "tgh", "tgk", "teuku", "tuan", "haji", "hajjah",
    "rd", "raden", "komjen", "pol", "purn", "lc", "ma",
}  # fmt: skip
# Trailing degrees/initials and everything after a comma are not part of the name ("… RIZA W., M.Si.").
# The patterns must not eat name characters mid-token: "MUSLEM.D" must stay "MUSLEM D", not become "MU".
DEGREE_SUFFIX = re.compile(r"(?:\s+[a-z]{1,4}\.)+$", re.IGNORECASE)


def _part_match(token: str, other: str) -> bool:
    """One token covers another ("rusli"→"muh.rusli" no; "yusuf"→"yusuf" yes; "ritangnga"→"r"? no)."""
    if token == other:
        return True
    shorter, longer = (token, other) if len(token) <= len(other) else (other, token)
    if shorter.startswith(longer) or longer.startswith(shorter):
        return True
    return len(shorter) >= 4 and SequenceMatcher(None, shorter, longer).ratio() >= 0.85


def _covers(shorter: tuple[str, ...], longer: tuple[str, ...]) -> bool:
    """Every token of the shorter name is present in the longer one (order-free, one-to-one)."""
    remaining = list(longer)
    for token in shorter:
        for index, other in enumerate(remaining):
            if _part_match(token, other):
                remaining.pop(index)
                break
        else:
            return False
    return True


def person_tokens(name: str) -> tuple[str, ...]:
    """Name tokens without honorifics or trailing degrees ("DR. H. DANDAN RIZA W., M.Si." → dandan riza)."""
    head = name.split(",")[0]
    head = DEGREE_SUFFIX.sub("", head).strip() or head
    tokens = []
    for raw in re.split(r"[\s.\-]+", head.lower()):
        token = re.sub(r"[^a-z]", "", raw)
        if token and token not in TITLE_TOKENS:
            tokens.append(token)
    return tuple(tokens)


def similarity(left: str, right: str) -> float:
    """0–1 likeness of two spellings of a name; tolerant of spacing, hyphens, initials and typos."""
    a, b = person_tokens(left), person_tokens(right)
    if not a or not b:
        return 0.0
    set_a, set_b = set(a), set(b)
    if set_a <= set_b or set_b <= set_a:
        return 1.0
    compact_a, compact_b = "".join(a), "".join(b)
    if min(len(compact_a), len(compact_b)) >= 6 and (compact_a in compact_b or compact_b in compact_a):
        return 0.95
    # One name's tokens all appear in the other ("Muhammad Rusli" in "MUH. RUSLI"; "Respati Ardi" in
    # "Respati Achmad Ardianto") — the Wikipedia short form against the KPU full name.
    if min(len(a), len(b)) >= 2:
        shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
        if _covers(shorter, longer):
            return 0.95
    # Initials: "AFNI Z" vs "Afni Zulkifli".
    initials = all(any(x == y or (len(x) == 1 and y.startswith(x)) or (len(y) == 1 and x.startswith(y)) for y in b) for x in a)
    if initials and len(set_a & set_b) >= 1:
        return 0.9
    return SequenceMatcher(None, compact_a, compact_b).ratio()


def same_person(left: str, right: str, threshold: float = 0.8) -> bool:
    return similarity(left, right) >= threshold
