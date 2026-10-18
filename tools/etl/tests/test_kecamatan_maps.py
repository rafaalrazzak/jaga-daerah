import math
import re

import pytest

from jaga_etl.boundaries.build import parse
from jaga_etl.kecamatan_maps.build import (
    WIDTH,
    GateError,
    build_all,
    fit_projection,
    kecamatan_names,
    parse_kecamatan,
)

REGION = re.compile(r"\d{2}\.\d{2}")

WILAYAH = """
INSERT INTO wilayah VALUES ('32','JAWA BARAT'),('32.73','Kota Bandung'),
('32.73.01','Sukasari'),('32.73.02','Coblong'),('32.73.02.1001','Dago');
"""
# Boundary names deliberately differ from Kemendagri: the output must use the Kemendagri names.
KECAMATAN = """
INSERT INTO wilayah_boundaries VALUES
('32.73.01','SUKASARI (boundary name)',-6.85,107.55,'[[[-6.8,107.5],[-6.8,107.6],[-6.9,107.6],[-6.9,107.5],[-6.8,107.5]]]'),
('32.73.02','Coblong X',-6.85,107.65,'[[[[-6.8,107.6],[-6.8,107.7],[-6.9,107.7],[-6.9,107.6],[-6.8,107.6]]],[[[-6.95,107.69],[-6.95,107.6905],[-6.9505,107.6905],[-6.95,107.69]]]]');
"""
OUTLINE = """
('32.73','Kota Bandung',-6.85,107.6,'[[[-6.8,107.5],[-6.8,107.7],[-6.9,107.7],[-6.9,107.5],[-6.8,107.5]]]');
"""


def inputs() -> tuple[dict[str, str], dict, list[str], dict]:
    boundaries, duplicates = parse_kecamatan([KECAMATAN])
    return kecamatan_names(WILAYAH), boundaries, duplicates, parse(OUTLINE, REGION)


def test_kecamatan_names_keep_only_kecamatan_level() -> None:
    assert kecamatan_names(WILAYAH) == {"32.73.01": "Sukasari", "32.73.02": "Coblong"}


def test_projection_follows_the_documented_formula() -> None:
    names, boundaries, duplicates, outlines = inputs()

    projection, height = fit_projection([*boundaries.values(), *outlines.values()])

    assert projection.west == pytest.approx(107.5)
    assert projection.north == pytest.approx(-6.8)
    assert projection.cos_lat == pytest.approx(math.cos(math.radians((-6.8 + -6.9505) / 2)), abs=1e-8)
    x, y = projection(-6.9, 107.7)
    assert x == pytest.approx((107.7 - projection.west) * projection.scale * projection.cos_lat)
    assert y == pytest.approx((projection.north - -6.9) * projection.scale)
    assert x == pytest.approx(WIDTH, abs=0.01)  # east edge lands on the fixed width
    assert height == math.ceil((-6.8 - -6.9505) * projection.scale)


def test_build_joins_names_by_code_and_sorts_by_name() -> None:
    names, boundaries, duplicates, outlines = inputs()

    output = build_all(["32.73"], names, boundaries, duplicates, outlines)["32.73"]

    assert output["code"] == "32.73"
    assert output["width"] == WIDTH
    assert set(output["projection"]) == {"west", "north", "scale", "cos_lat"}
    assert output["outline"].startswith("M")
    assert [(k["code"], k["name"]) for k in output["kecamatan"]] == [
        ("32.73.02", "Coblong"),
        ("32.73.01", "Sukasari"),
    ]
    for kecamatan in output["kecamatan"]:
        assert 0 <= kecamatan["cx"] <= WIDTH and 0 <= kecamatan["cy"] <= output["height"]


def test_simplification_keeps_valid_rings_and_tiny_islands() -> None:
    names, boundaries, duplicates, outlines = inputs()

    coblong = next(
        k for k in build_all(["32.73"], names, boundaries, duplicates, outlines)["32.73"]["kecamatan"]
        if k["code"] == "32.73.02"
    )

    rings = re.findall(r"M([^Z]*)Z", coblong["path"])
    assert len(rings) == 2  # the small island survives as its own ring
    for ring in rings:
        points = ring.split("L")
        assert len(points) >= 3
        assert all(re.fullmatch(r"-?\d+\.\d,-?\d+\.\d", point) for point in points)


def test_gate_fails_on_a_kecamatan_without_boundary() -> None:
    names, boundaries, duplicates, outlines = inputs()
    names["32.73.03"] = "Cidadap"

    with pytest.raises(GateError, match=r"1 kecamatan without a boundary \['32.73.03'\]"):
        build_all(["32.73"], names, boundaries, duplicates, outlines)


def test_gate_fails_on_an_unknown_boundary_code() -> None:
    names, boundaries, duplicates, outlines = inputs()
    del names["32.73.02"]

    with pytest.raises(GateError, match=r"boundary codes not in the Kemendagri list \['32.73.02'\]"):
        build_all(["32.73"], names, boundaries, duplicates, outlines)


def test_gate_fails_on_duplicate_boundary_codes() -> None:
    boundaries, duplicates = parse_kecamatan([KECAMATAN, KECAMATAN.split("\n")[2]])
    names, _, _, outlines = inputs()

    assert duplicates == ["32.73.01"]
    with pytest.raises(GateError, match="duplicate kecamatan boundary codes"):
        build_all(["32.73"], names, boundaries, duplicates, outlines)


def test_gate_fails_on_a_region_without_outline() -> None:
    names, boundaries, duplicates, _ = inputs()

    with pytest.raises(GateError, match=r"regions without an outline \['32.73'\]"):
        build_all(["32.73"], names, boundaries, duplicates, {})
