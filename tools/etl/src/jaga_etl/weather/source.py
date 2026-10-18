"""Pinned BMKG normal-rainfall climatology and the reuse terms that apply to it.

The product is BMKG's monthly normal (long-term average) rainfall for the 1981–2010 period,
published as a raster service on BMKG's own "Satu Peta MKG" geospatial portal
(`gis.bmkg.go.id`). It is read through the portal's declared REST API, not by scraping a page.

Why this source and not the open forecast feed: `api.bmkg.go.id/publik/prakiraan-cuaca` returns a
3-day forecast refreshed twice daily, which is a live dependency (PRD §5 excludes real-time data and
PRD §9 requires the demo to work without upstream availability). The normal-rainfall product is a
finished climatology: it does not change between runs, so the published figure is reproducible from
the sealed snapshot alone.

WHAT THE FIGURE IS, precisely — this is the weakest link in the design:
    - the source is a RASTER queried by coordinate, not a per-region table, so a region's figure is
      the value of the raster cell under ONE sample point inside it (the reviewed coordinate in
      `reference/weather-sample-points.csv`, normally the area centroid of the region's largest
      polygon);
    - that single point therefore STANDS IN for a whole kabupaten/kota. It is not an areal average
      and not a measurement of every part of the region: a kabupaten spanning coastal plain and
      mountain has one figure for both, and a reader could over-trust it if the UI called it
      "the region's rainfall" without qualification. The component must say the value is an
      approximation for the region and name the point, and it must label the 1981–2010 period so
      nobody reads it as current weather;
    - coverage: 510 of the 514 kabupaten/kota. Four have no publishable value — 11.72 (Kota Sabang)
      and 96.01 (Kabupaten Sorong) fall outside the raster entirely, and 52.04 (Kabupaten Sumbawa)
      and 52.05 (Kabupaten Dompu) report physically impossible negative normals. Those regions
      publish "Data belum tersedia" with the reason, never a zero and never a partial sum.

Reuse terms (read 17 October 2026; recorded verbatim in the published file):
    - attribution is mandatory ("Sumber: BMKG", BMKG logo, citation of the product title and URL);
    - "Pengemasan ulang, integrasi ke aplikasi pihak ketiga, atau penggunaan data untuk tujuan
      komersial wajib melalui izin tertulis resmi dari BMKG";
    - "Pengaksesan layanan berupa data dan/atau informasi secara otomatis atau menggunakan metode
      machine-to-machine wajib melalui jalur Application Programming Interface (API) resmi".
Perka BMKG No. 4 Tahun 2022 classifies processed/statistical climate data as Data Level 2 and routes
access through BMKG's online service, a data request form, or a cooperation agreement. The
integration permission has NOT been granted, so the section carries a known residual reuse risk and
must be published with attribution and a link to the terms (see the README section).
"""

from urllib.parse import urlencode

SERVICE_URL = (
    "https://gis.bmkg.go.id/arcgis/rest/services/Normal_hujan_30th/Normal_curah_hujan/MapServer"
)
IDENTIFY_URL = f"{SERVICE_URL}/identify"
PORTAL_URL = "https://gis.bmkg.go.id/portal/"

PUBLISHER = "Badan Meteorologi, Klimatologi, dan Geofisika (BMKG)"
TITLE = "Normal Curah Hujan bulanan, periode 1981–2010 (Peta Normal Curah Hujan)"
LICENSE = (
    "BMKG Ketentuan Penggunaan: atribusi “Sumber: BMKG” wajib; pengemasan ulang atau integrasi ke "
    "aplikasi pihak ketiga memerlukan izin tertulis resmi BMKG; akses otomatis wajib melalui API "
    "resmi. Izin tertulis belum diperoleh."
)
LICENSE_URL = "https://www.bmkg.go.id/ketentuan-penggunaan"
ATTRIBUTION = "Sumber: BMKG"

PERIOD_START = 1981
PERIOD_END = 2010
MONTHS = 12
# One layer per calendar month, ids 0–11 in January–December order (verified against the service).
MONTH_LAYERS = tuple(range(MONTHS))

# The sampling tolerance in degrees: identify resolves the raster cell under the point, and
# `tolerance=1` is the pixel the portal itself counts as the point's cell.
TOLERANCE = 1
# A tight map extent keeps identify from resampling the raster to a coarser display grid: at ±0.2°
# over 400 px the display resolution stays finer than the ~0.05° product grid.
EXTENT_DEGREES = 0.2
IMAGE_DISPLAY = "400,400,96"

#: `identify` is called once per candidate sample point, so the fetch is polite by construction: one
#: request at a time, spaced, with an identifying User-Agent.
REQUEST_DELAY_SECONDS = 0.3


def identify_url(latitude: float, longitude: float) -> str:
    """The exact request URL for one sample point, so the snapshot can record and verify it."""
    geometry = (
        '{"x":%s,"y":%s,"spatialReference":{"wkid":4326}}' % (repr(longitude), repr(latitude))
    )
    return IDENTIFY_URL + "?" + urlencode(
        {
            "geometry": geometry,
            "geometryType": "esriGeometryPoint",
            "layers": "all",
            "tolerance": str(TOLERANCE),
            "mapExtent": (
                f"{longitude - EXTENT_DEGREES},{latitude - EXTENT_DEGREES},"
                f"{longitude + EXTENT_DEGREES},{latitude + EXTENT_DEGREES}"
            ),
            "imageDisplay": IMAGE_DISPLAY,
            "returnGeometry": "false",
            "f": "json",
        }
    )
