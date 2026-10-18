from decimal import Decimal
from pathlib import Path

from jaga_etl.land_cover.parse import LandCoverParseError, hectares_of, parse_rekap

ACEH = """
| 1 | Provinsi ACEH |
| A. Hutan | 780,00 | 1.643,70 | 114,00 | 372,30 | 2.909,50 | 2,00 | 2.911,50 | 239,60 | 3.151,10 | 55,68 |
| - Hutan Primer | 603,80 | 1.112,40 | 49,50 | 144,70 | 1.910,40 | 0,00 | 1.910,40 | 24,20 | 1.934,60 | 34,18 |
| - Hutan Sekunder | 168,40 | 523,50 | 54,80 | 176,10 | 922,80 | 1,30 | 924,10 | 164,80 | 1.088,90 | 19,24 |
| - Hutan Tanaman | 7,80 | 7,30 | 9,70 | 51,50 | 76,30 | 0,70 | 77,00 | 50,60 | 127,60 | 2,25 |
| B. Non Hutan | 79,70 | 150,90 | 28,90 | 177,70 | 437,20 | 11,60 | 448,80 | 2.059,40 | 2.508,20 | 44,32 |
| Total | 859,70 | 1.794,10 | 142,90 | 550,00 | 3.346,70 | 13,60 | 3.360,30 | 2.299,00 | 5.659,30 | 100,00 |
"""

REPO = Path(__file__).resolve().parents[3]


def _pad(body: str, count: int) -> str:
    """The parser requires all 38 provinces. Repeat Aceh under distinct names for the unit test."""
    blocks = []
    for index in range(count):
        blocks.append(body.replace("Provinsi ACEH", f"Provinsi CONTOH {index}"))
    return "\n".join(blocks)


def test_aceh_classes_convert_thousand_hectares_and_check_the_total():
    covers = parse_rekap(_pad(ACEH, 38))
    aceh = covers[0]
    assert aceh.hectares["hutan_primer"] == Decimal("1934.60")
    assert hectares_of(aceh)["hutan_primer"] == "1934600.00"
    assert hectares_of(aceh)["bukan_hutan"] == "2508200.00"


def test_a_class_sum_that_misses_the_total_is_rejected():
    broken = ACEH.replace("| 2.508,20 | 44,32 |", "| 2.500,00 | 44,32 |")
    try:
        parse_rekap(_pad(broken, 38))
    except LandCoverParseError as error:
        assert "tidak sama" in str(error)
    else:
        raise AssertionError("expected a total mismatch")


def test_published_aceh_matches_the_rekap():
    path = REPO / "apps" / "web" / "src" / "data" / "land-cover.json"
    if not path.exists():
        return
    import json

    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = {row["class"]: row["hectares"] for row in payload["provinces"]["11"]["rows"]}
    assert rows["hutan_primer"] == "1934600.00"
    assert payload["level"] == "provinsi"
    assert payload["year"] == 2023
