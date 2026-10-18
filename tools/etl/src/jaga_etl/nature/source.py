"""Pinned upstream sources for per-kabupaten/kota natural-condition facts.

Two publishers, and both payloads already carry the region code, so nothing is joined by name:

- **BIG** (Badan Informasi Geospasial) publishes the statutory area of every administrative
  boundary in the national geodatabase, keyed by the Kemendagri code (`KDPKAB`).
- **BNPB** publishes recorded disaster events per kabupaten/kota through its CKAN portal, keyed by
  the same Kemendagri code. The XLSX download links on that portal sit behind an interactive bot
  challenge, so rows are read from the official `datastore_search` API, exactly as the existing
  province-level module (`jaga_etl.facts.bnpb`) does.

**IRBI (BNPB InaRISK) is deliberately NOT a source here.** InaRISK publishes an official
kabupaten/kota disaster-risk index, but its own disclaimer forbids reuse:

    "Seluruh konten, data, dan tampilan dalam InaRISK dilindungi oleh hak cipta. Dilarang
     mengutip, menyalin, atau menggunakan tanpa izin tertulis dari BNPB."

The same notice appears on the IRBI publication PDF ("Dilarang mengutip atau memperbanyak
sebagian atau seluruh isi buku tanpa izin tertulis penerbit"). Republishing those figures is
therefore not permitted, and no figure is taken from InaRISK. A risk index is also never
re-derived, re-weighted or interpolated here: the values published are ones the source states.
"""

from dataclasses import dataclass

# --- BIG: statutory area per boundary ---------------------------------------------------------

# Public ArcGIS Enterprise portal. No API key, no login, no bot challenge on this layer.
BIG_PORTAL = "https://geoservices.big.go.id"
BIG_LAYER = f"{BIG_PORTAL}/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer/0"
# `returnGeometry=false` returns the attribute table without polygons; one request covers all rows
# (541 < the service's maxRecordCount of 1000), and the count query is fetched too so a silently
# truncated response cannot pass unnoticed.
BIG_QUERY_URL = (
    f"{BIG_LAYER}/query?where=1%3D1&outFields=KDPKAB,KDPPUM,WADMKK,WADMPR,TIPADM,LUASWH,METADATA"
    "&returnGeometry=false&f=json&resultRecordCount=1000"
)
BIG_COUNT_URL = f"{BIG_LAYER}/query?where=1%3D1&returnCountOnly=true&f=json"
BIG_PUBLISHER = "Badan Informasi Geospasial (BIG)"
BIG_SOURCE_URL = "https://geoservices.big.go.id/portal/home/"
# Field alias for TIPADM values that are a kabupaten (4) or a kota (5).
BIG_KABUPATEN_TIPADM = 4
BIG_KOTA_TIPADM = 5

# BIG states no licence or terms of reuse anywhere we could find: the layer's `copyrightText` is
# empty, the portal item's `licenseInfo` is null, and the service/product pages on big.go.id carry
# only a zero-rupiah service page and a service charter. Nothing forbids reuse, but nothing grants
# it either, so the value is published with `license: null` and this recorded caveat for the owner.
BIG_LICENSE: str | None = None
BIG_REUSE_NOTE = (
    "BIG tidak mencantumkan lisensi atau syarat penggunaan ulang untuk layanan ini "
    "(copyrightText kosong, licenseInfo null, dan halaman layanan big.go.id tidak memuat "
    "pernyataan lisensi). Tidak ada larangan, tetapi juga tidak ada izin tertulis; "
    "keputusan penggunaan ulang dicatat sebagai keputusan pemilik."
)

# --- BNPB: recorded disaster events per kabupaten/kota ----------------------------------------

BNPB_PORTAL = "https://data.bnpb.go.id"
BNPB_DATASTORE_SEARCH = f"{BNPB_PORTAL}/api/3/action/datastore_search"
BNPB_PAGE_LIMIT = 1000


@dataclass(frozen=True)
class BnpbResource:
    """One CKAN datastore resource: a single publication table of the disaster compilation."""

    name: str
    dataset: str
    resource_id: str
    license: str


# "Kompilasi Data Kejadian dan Dampak Bencana", published by BNPB's Pusat Data Informasi dan
# Komunikasi Kebencanaan. Both datasets declare an Open Data Commons licence, so reuse is granted
# with attribution.
BNPB_KABUPATEN_YEARS = BnpbResource(
    name="Jumlah Kejadian Bencana Menurut Kabupaten Tahun 2010-2024",
    dataset="data-bencana-indonesia",
    resource_id="21044ffd-c397-4b3c-acbd-5adaa03d79e3",
    license="ODC-BY",
)
BNPB_KABUPATEN_2024 = BnpbResource(
    name="Jumlah Kejadian Bencana Menurut Kabupaten, 2024",
    dataset="data-bencana-indonesia",
    resource_id="a4daec53-1119-43ef-b05e-00ec3a4c42a4",
    license="ODC-BY",
)

# The 2024 dataset's per-kabupaten/kota IMPACT tables, one metric per resource, each holding the
# same nine hazard columns. Published under ODbL (a share-alike database licence), so the derived
# database this module writes is offered under the same terms.
BNPB_IMPACT_DATASET = "kompilasi-data-jumlah-dan-dampak-kejadian-bencana-2024"
BNPB_IMPACT_LICENSE = "ODbL"
BNPB_IMPACTS: tuple[BnpbResource, ...] = (
    BnpbResource(
        name="Jumlah Korban Meninggal Dunia Akibat Bencana Menurut Kabupaten 2024",
        dataset=BNPB_IMPACT_DATASET,
        resource_id="bf415deb-7076-4aaf-90ad-013b9a5292f7",
        license=BNPB_IMPACT_LICENSE,
    ),
    BnpbResource(
        name="Jumlah Korban Hilang Akibat Bencana Menurut Kabupaten 2024",
        dataset=BNPB_IMPACT_DATASET,
        resource_id="4cddaa9f-45b1-47f5-9428-519e876a8e20",
        license=BNPB_IMPACT_LICENSE,
    ),
    BnpbResource(
        name="Jumlah Korban Luka / Sakit Akibat Bencana Menurut Kabupaten 2024",
        dataset=BNPB_IMPACT_DATASET,
        resource_id="820e56bc-fd26-4e47-ae12-5b23f1d5fd08",
        license=BNPB_IMPACT_LICENSE,
    ),
    BnpbResource(
        name="Jumlah Korban Terdampak Akibat Bencana Menurut Kabupaten 2024",
        dataset=BNPB_IMPACT_DATASET,
        resource_id="89eb9dac-a891-477e-b264-2265f72f4e56",
        license=BNPB_IMPACT_LICENSE,
    ),
    BnpbResource(
        name="Jumlah Korban Mengungsi Akibat Bencana Menurut Kabupaten 2024",
        dataset=BNPB_IMPACT_DATASET,
        resource_id="68c4448c-3de9-42e3-987d-31f5c05c37ba",
        license=BNPB_IMPACT_LICENSE,
    ),
    BnpbResource(
        name="Jumlah Rumah Rusak Akibat Bencana Menurut Kabupaten 2024",
        dataset=BNPB_IMPACT_DATASET,
        resource_id="5c9f7ea9-f809-487c-b1f8-f05a6f3291b3",
        license=BNPB_IMPACT_LICENSE,
    ),
)
BNPB_RESOURCES = (BNPB_KABUPATEN_YEARS, BNPB_KABUPATEN_2024, *BNPB_IMPACTS)
BNPB_PUBLISHER = "Badan Nasional Penanggulangan Bencana (BNPB)"
# The event series and the 2024-by-type table are published under ODC-BY; the impact tables under
# ODbL. Both are stated per resource in the artifact, so a reader can see which terms apply where.
BNPB_EVENT_LICENSE = "ODC-BY"
BNPB_IMPACT_LICENSE = "ODbL"

# Impact metric key → the resource that publishes it. Keys are the shape the artifact uses.
BNPB_IMPACT_METRICS: dict[str, str] = {
    "deaths": "bf415deb-7076-4aaf-90ad-013b9a5292f7",
    "missing": "4cddaa9f-45b1-47f5-9428-519e876a8e20",
    "injured": "820e56bc-fd26-4e47-ae12-5b23f1d5fd08",
    "affected": "89eb9dac-a891-477e-b264-2265f72f4e56",
    "displaced": "68c4448c-3de9-42e3-987d-31f5c05c37ba",
    "houses_damaged": "5c9f7ea9-f809-487c-b1f8-f05a6f3291b3",
}

# Source column → hazard key. The nine columns are the publication's own classification; the
# snake_case keys match the disaster-type names the province-level module already uses, so the two
# modules describe the same hazards the same way.
BNPB_HAZARD_COLUMNS: dict[str, str] = {
    "BANJIR": "banjir",
    "CUACA EKSTREM": "cuaca_ekstrem",
    "ERUPSI GUNUNG API": "erupsi_gunung_api",
    "GELOMBANG PASANG DAN ABRASI": "gelombang_pasang_abrasi",
    "GEMPABUMI": "gempabumi",
    "KEBAKARAN HUTAN DAN LAHAN": "kebakaran_hutan_lahan",
    "KEKERINGAN": "kekeringan",
    "TANAH LONGSOR": "tanah_longsor",
    "TSUNAMI": "tsunami",
}
BNPB_CODE_COLUMN = "Kode Wilayah Kabupaten / Kota"
BNPB_NAME_COLUMN = "Nama Kabupaten/Kota"
# The row that totals the country: it carries no region code and is never a region.
BNPB_NATIONAL_NAME = "INDONESIA"
# The 2010-2024 table's year columns are labelled "2010.0" … "2024.0".
BNPB_FIRST_YEAR = 2010
BNPB_LAST_YEAR = 2024
BNPB_YEAR_COLUMN = "{year}.0"


def resource_file_name(resource: BnpbResource) -> str:
    return f"bnpb-{resource.resource_id}.json"


def datastore_url(resource: BnpbResource) -> str:
    return f"{BNPB_DATASTORE_SEARCH}?resource_id={resource.resource_id}&limit={BNPB_PAGE_LIMIT}"


def dataset_url(resource: BnpbResource) -> str:
    return f"{BNPB_PORTAL}/dataset/{resource.dataset}"
