"""Tests for the live-points reference file: the adm4 rule, kecamatan list, bbox and the gate.

Small inline fixtures stand in for the wilayah dump, the boundary snapshot and the sample-point CSV,
so the tests run offline and do not depend on files outside version control.
"""

import json
from pathlib import Path

import pytest

from jaga_etl.boundaries.build import parse
from jaga_etl.live_points.build import (
    QualityGateError,
    build_regions,
    outward_bbox,
    parse_subdivisions,
    reference_adm4,
)
from jaga_etl.live_points.__main__ import REGION_CODE
from jaga_etl.weather.build import read_reference
from jaga_etl.web_data import write_json

# Kecamatan 32.01.02 is listed first and 32.01.01 has no `.1001`, so file order or the usual
# `XX.YY.01.1001` guess would both pick the wrong desa.
WILAYAH = """
INSERT INTO wilayah (kode, nama) VALUES
('32','Jawa Barat'),
('32.01','Kabupaten Bogor'),
('32.01.02','Megamendung'),
('32.01.02.2001','Sukamaju'),
('32.01.01','Cibinong'),
('32.01.01.1003','Harapanjaya'),
('32.01.01.1002','Karadenan'),
('32.01.03','Babakan Madang'),
('32.01.03.2001','Bojong Koneng'),
('32.71','Kota Bogor'),
('32.71.05','Tanah Sereal'),
('32.71.05.1001','Kedung Badak'),
('32.71.01','Bogor Selatan'),
('32.71.01.1002','Batutulis'),
('32.71.01.1001','Bondongan');
"""

BOUNDARIES = """
INSERT INTO wilayah_boundaries VALUES
('32.01','Kabupaten Bogor',-6.5,106.8,'[[[-6.7891,106.4012],[-6.3021,106.4012],[-6.3021,107.2279],[-6.7891,107.2279]]]'),
('32.71','Kota Bogor',-6.6,106.8,'[[[[-6.65,106.75],[-6.55,106.75],[-6.55,106.85],[-6.65,106.85]]],[[[-6.70,106.70],[-6.69,106.70],[-6.69,106.71]]]]');
"""

POINTS = """code,latitude,longitude,method,note
32.01,-6.561049,106.768234,centroid,titik sampel
32.71,-6.600001,106.800004,centroid,titik sampel
"""

REFERENCE = [
    {
        "code": "32.01",
        "name": "Kabupaten Bogor",
        "slug": "kabupaten-bogor",
        "type": "kabupaten",
        "province": {"code": "32", "name": "Jawa Barat", "slug": "jawa-barat"},
    },
    {
        "code": "32.71",
        "name": "Kota Bogor",
        "slug": "kota-bogor",
        "type": "kota",
        "province": {"code": "32", "name": "Jawa Barat", "slug": "jawa-barat"},
    },
]


@pytest.fixture
def points(tmp_path: Path):
    path = tmp_path / "points.csv"
    path.write_text(POINTS, encoding="utf-8")
    return read_reference(path)


def test_adm4_rule_picks_lowest_kecamatan_then_lowest_desa() -> None:
    subdivisions = parse_subdivisions(WILAYAH)
    assert reference_adm4(subdivisions, "32.01") == ("32.01.01.1002", "Karadenan", "32.01.01", "Cibinong")
    assert reference_adm4(subdivisions, "32.71") == ("32.71.01.1001", "Bondongan", "32.71.01", "Bogor Selatan")


def test_records_carry_every_kecamatan_with_its_own_point_sorted_by_name(points) -> None:
    records = build_regions(REFERENCE, parse_subdivisions(WILAYAH), points, parse(BOUNDARIES, REGION_CODE))
    bogor = records["kabupaten-bogor"]
    assert bogor["kecamatan_list"] == [
        {"code": "32.01.03", "name": "Babakan Madang", "adm4": "32.01.03.2001", "desa": "Bojong Koneng"},
        {"code": "32.01.01", "name": "Cibinong", "adm4": "32.01.01.1002", "desa": "Karadenan"},
        {"code": "32.01.02", "name": "Megamendung", "adm4": "32.01.02.2001", "desa": "Sukamaju"},
    ]
    # The region default is one entry of the list.
    default = {"code": "32.01.01", "name": bogor["kecamatan"], "adm4": bogor["adm4"], "desa": bogor["desa"]}
    assert default in bogor["kecamatan_list"]
    assert (bogor["lat"], bogor["lon"]) == (-6.561, 106.7682)
    assert bogor["adm4"] == "32.01.01.1002" and bogor["desa"] == "Karadenan"
    assert bogor["province_code"] == "32" and bogor["province_name"] == "Jawa Barat"


def test_bbox_rounds_outward_and_contains_every_part_of_the_outline(points) -> None:
    boundaries = parse(BOUNDARIES, REGION_CODE)
    assert outward_bbox(boundaries["32.01"]) == [106.401, -6.79, 107.228, -6.302]
    # The second polygon (a small islet to the south-west) must widen the box.
    assert outward_bbox(boundaries["32.71"]) == [106.7, -6.7, 106.85, -6.55]
    records = build_regions(REFERENCE, parse_subdivisions(WILAYAH), points, boundaries)
    for record in records.values():
        west, south, east, north = record["bbox"]
        assert west <= record["lon"] <= east and south <= record["lat"] <= north


def test_gate_rejects_a_missing_region(points) -> None:
    dump = WILAYAH.replace("('32.71','Kota Bogor'),", "")
    with pytest.raises(QualityGateError) as error:
        build_regions(REFERENCE, parse_subdivisions(dump), points, parse(BOUNDARIES, REGION_CODE))
    assert any("wilayah do not match" in problem and "32.71" in problem for problem in error.value.problems)


def test_gate_rejects_a_region_without_a_valid_adm4(points) -> None:
    # Desa codes of the wrong shape are not adm4 rows, so the region is left without one.
    dump = WILAYAH.replace("32.71.01.1001", "32.71.01.10011").replace("32.71.01.1002", "32.71.01.100")
    with pytest.raises(QualityGateError) as error:
        build_regions(REFERENCE, parse_subdivisions(dump), points, parse(BOUNDARIES, REGION_CODE))
    assert error.value.problems == ["32.71: no kecamatan with a kelurahan/desa in wilayah"]


def test_gate_rejects_any_kecamatan_without_a_desa(points) -> None:
    # 32.01.03 is not the default kecamatan, but a pickable kecamatan still needs a forecast point.
    dump = WILAYAH.replace("('32.01.03.2001','Bojong Koneng'),", "")
    with pytest.raises(QualityGateError) as error:
        build_regions(REFERENCE, parse_subdivisions(dump), points, parse(BOUNDARIES, REGION_CODE))
    assert error.value.problems == ["32.01: kecamatan 32.01.03 has no kelurahan/desa in wilayah"]


def test_gate_rejects_duplicate_codes(points) -> None:
    dump = WILAYAH.replace("('32.01.03','Babakan Madang'),", "('32.01.03','Babakan Madang'),('32.01.03','Babakan'),")
    with pytest.raises(QualityGateError) as error:
        build_regions(REFERENCE, parse_subdivisions(dump), points, parse(BOUNDARIES, REGION_CODE))
    assert error.value.problems == ["wilayah has duplicate codes: ['32.01.03']"]


def test_gate_rejects_a_point_outside_the_bbox(tmp_path: Path) -> None:
    path = tmp_path / "points.csv"
    path.write_text(POINTS.replace("-6.600001,106.800004", "-7.5,106.8"), encoding="utf-8")
    with pytest.raises(QualityGateError) as error:
        build_regions(REFERENCE, parse_subdivisions(WILAYAH), read_reference(path), parse(BOUNDARIES, REGION_CODE))
    assert len(error.value.problems) == 1
    assert error.value.problems[0].startswith("32.71: sample point (-7.5, 106.8) is outside its bbox")


def test_gate_rejects_a_name_that_disagrees_with_wilayah(points) -> None:
    reference = [dict(REFERENCE[0], name="Kabupaten Bogor Raya"), REFERENCE[1]]
    with pytest.raises(QualityGateError) as error:
        build_regions(reference, parse_subdivisions(WILAYAH), points, parse(BOUNDARIES, REGION_CODE))
    assert "32.01: regions.json name" in error.value.problems[0]


def test_write_json_inlines_short_scalar_arrays_like_oxfmt(tmp_path: Path) -> None:
    path = tmp_path / "out.json"
    payload = {"a": {"bbox": [1.5, -2.0], "names": ["x" * 120], "empty": []}}
    write_json(path, payload)
    text = path.read_text(encoding="utf-8")
    assert '"bbox": [1.5, -2.0],' in text
    assert '"names": [\n      "' in text
    assert json.loads(text) == payload
