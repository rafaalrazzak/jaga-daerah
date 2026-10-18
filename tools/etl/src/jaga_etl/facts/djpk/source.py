"""DJPK Portal Data SIKD endpoints (djpk.kemenkeu.go.id/portal/data/apbd and /portal/data/tkdd).

The portal publishes APBD anggaran and realisasi per pemda as a SpreadsheetML export. `periode=12`
requests the year-end position (for the current year the portal returns the latest month instead,
which is why only closed years are imported). DJPK uses its own province/pemda codes, which are
mapped to Kemendagri codes in `mapping.py`.
"""

PORTAL = "https://djpk.kemenkeu.go.id/portal"
YEAR_END_PERIOD = 12
PROVINCE_LEVEL_PEMDA = "00"
ALL_SENTINEL = "--"


def provinces_url(year: int) -> str:
    return f"{PORTAL}/data/apbd?periode={YEAR_END_PERIOD}&tahun={year}&provinsi=--&pemda=--"


def pemda_url(province_code: str, year: int) -> str:
    return f"{PORTAL}/pemda/{province_code}/{year}"


def apbd_url(year: int, province_code: str, pemda_code: str) -> str:
    return (
        f"{PORTAL}/csv_apbd?type=apbd&periode={YEAR_END_PERIOD}&tahun={year}"
        f"&provinsi={province_code}&pemda={pemda_code}"
    )


def provinces_file(year: int) -> str:
    return f"provinces-{year}.html"


def pemda_file(year: int, province_code: str) -> str:
    return f"pemda-{year}-{province_code}.json"


def apbd_file(year: int, province_code: str, pemda_code: str) -> str:
    return f"apbd-{year}-{province_code}-{pemda_code}.xml"


# Transfer ke Daerah (TKDD) per pemda: includes Dana Bagi Hasil SDA lines. No period parameter; the
# portal returns the full-year allocation and realisation.
def tkdd_url(year: int, province_code: str, pemda_code: str) -> str:
    return f"{PORTAL}/csv?type=tkdd&tahun={year}&provinsi={province_code}&pemda={pemda_code}"


def tkdd_file(year: int, province_code: str, pemda_code: str) -> str:
    return f"tkdd-{year}-{province_code}-{pemda_code}.xml"
