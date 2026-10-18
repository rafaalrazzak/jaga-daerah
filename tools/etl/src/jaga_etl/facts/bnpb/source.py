"""Pinned BNPB CKAN resources ("Kompilasi Data Kejadian dan Dampak Bencana").

Rows are read through the official CKAN datastore API (`datastore_search`) rather than the XLSX
download links, which sit behind an interactive bot challenge. Each resource holds one metric for
38 provinces plus an INDONESIA total row, with one column per disaster type.
"""

from dataclasses import dataclass
from typing import Literal

Metric = Literal["event_count", "deaths", "missing", "affected"]

PORTAL = "https://data.bnpb.go.id"
DATASTORE_SEARCH = f"{PORTAL}/api/3/action/datastore_search"
PAGE_LIMIT = 100


@dataclass(frozen=True)
class BnpbResource:
    year: int
    metric: Metric
    resource_id: str
    dataset: str
    license: str


RESOURCES: tuple[BnpbResource, ...] = (
    BnpbResource(2024, "event_count", "f345ba43-99aa-428c-82d8-4b6a0bba380e", "kompilasi-data-jumlah-dan-dampak-kejadian-bencana-2024", "ODbL"),
    BnpbResource(2024, "deaths", "7a42016e-ce4d-402e-b10e-4e691a3c436f", "kompilasi-data-jumlah-dan-dampak-kejadian-bencana-2024", "ODbL"),
    BnpbResource(2024, "missing", "e5c7f8e7-c3b4-44ff-9581-e7d187240886", "kompilasi-data-jumlah-dan-dampak-kejadian-bencana-2024", "ODbL"),
    BnpbResource(2024, "affected", "39ceb577-b49f-45c9-b909-7dd8daef417a", "kompilasi-data-jumlah-dan-dampak-kejadian-bencana-2024", "ODbL"),
    BnpbResource(2025, "event_count", "df39e8c3-117e-40fa-b518-ff1037743955", "kompilasi-data-kejadian-dan-dampak-bencana-2025", "ODC-BY"),
    BnpbResource(2025, "deaths", "aefe8331-5962-4610-8b0c-2de637a336cd", "kompilasi-data-kejadian-dan-dampak-bencana-2025", "ODC-BY"),
    BnpbResource(2025, "missing", "f1de565c-c028-43e7-a48d-109ebb8f3081", "kompilasi-data-kejadian-dan-dampak-bencana-2025", "ODC-BY"),
    BnpbResource(2025, "affected", "8d8db1c8-d79b-4fb1-b735-d8b9c1e0517a", "kompilasi-data-kejadian-dan-dampak-bencana-2025", "ODC-BY"),
)

# Source column → disaster_type enum value (database/migrations 0002).
DISASTER_COLUMNS: dict[str, str] = {
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

NATIONAL_TOTAL_LABEL = "INDONESIA"


def resource_file_name(resource: BnpbResource) -> str:
    return f"{resource.year}-{resource.metric}-{resource.resource_id}.json"


def datastore_url(resource: BnpbResource) -> str:
    return f"{DATASTORE_SEARCH}?resource_id={resource.resource_id}&limit={PAGE_LIMIT}"


def dataset_url(resource: BnpbResource) -> str:
    return f"{PORTAL}/dataset/{resource.dataset}"
