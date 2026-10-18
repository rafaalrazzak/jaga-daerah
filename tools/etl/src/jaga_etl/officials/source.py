"""KPU infopemilu, Pilkada 2024 candidate pairs ("Pasangan Calon").

The public page loads its region list and candidate cards through two form POSTs:
`get_wilayah` (jenis_pemilihan=Bupati|Walikota → JSON list with an opaque region id) and
`filter` (id_wilayah → HTML cards). The cards also carry personal details (birth date, address,
religion, legal status); only the ballot number and the two names are ever extracted.
The source does not say who won, so elected status comes only from reviewed rows in
reference/pilkada-winners.csv, each with an official source URL.
"""

import re

PORTAL = "https://infopemilu.kpu.go.id/Pemilihan/Pasangan_calon"
REGIONS_URL = f"{PORTAL}/get_wilayah"
CANDIDATES_URL = f"{PORTAL}/filter"
ELECTIONS = ("Gubernur", "Bupati", "Walikota")


def regions_file(election: str) -> str:
    return f"wilayah-{election.lower()}.json"


def candidates_file(election: str, region_name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", region_name.lower()).strip("-")
    return f"paslon-{election.lower()}-{slug}.html"
