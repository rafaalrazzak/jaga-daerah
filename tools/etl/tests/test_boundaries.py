import re

import pytest

from jaga_etl.boundaries.build import Projection, build_map, parse, simplify, to_path

REGION = re.compile(r"\d{2}\.\d{2}")
PROVINCE = re.compile(r"\d{2}")

DUMP = """
INSERT INTO wilayah_boundaries VALUES
('32.73','Kota Bandung',-6.9,107.6,'[[[-6.8,107.5],[-6.8,107.7],[-7.0,107.7],[-7.0,107.5],[-6.8,107.5]]]'),
('32.04', 'Kab. Bandung' ,-7.1, 107.6 , '[[[[-7.0,107.3],[-7.0,107.9],[-7.3,107.9],[-7.3,107.3],[-7.0,107.3]]]]'),
('32.73.01','Kecamatan',-6.9,107.6,'[[[-6.8,107.5],[-6.8,107.6],[-6.9,107.6]]]');
"""
PROVINCE_DUMP = """
('32','Jawa Barat',-6.9,107.6,'[[[-5.9,106.0],[-5.9,108.8],[-7.8,108.8],[-7.8,106.0],[-5.9,106.0]]]');
"""


def test_parse_tolerates_whitespace_and_both_nesting_depths() -> None:
    regions = parse(DUMP, REGION)

    assert sorted(regions) == ["32.04", "32.73"]  # sub-district rows are ignored
    assert regions["32.04"].name == "Kab. Bandung"
    assert len(regions["32.04"].polygons) == 1
    assert regions["32.73"].polygons[0][0][0] == (-6.8, 107.5)


def test_simplify_keeps_endpoints_and_drops_collinear_points() -> None:
    points = [(0.0, 0.0), (1.0, 0.01), (2.0, 0.0), (3.0, 5.0)]

    assert simplify(points, 0.5) == [(0.0, 0.0), (2.0, 0.0), (3.0, 5.0)]


def test_build_map_projects_into_the_fixed_width() -> None:
    regions = parse(DUMP, REGION)
    provinces = parse(PROVINCE_DUMP, PROVINCE)

    output = build_map(regions, provinces)

    assert output["width"] == 1200.0
    assert [region["code"] for region in output["regions"]] == ["32.04", "32.73"]
    province = output["provinces"][0]
    assert province["box"][0] == pytest.approx(0, abs=0.1)
    assert province["box"][2] == pytest.approx(1200, abs=0.1)
    assert all(region["path"].startswith("M") for region in output["regions"])


def test_tiny_regions_stay_visible_as_a_marker() -> None:
    provinces = parse(PROVINCE_DUMP, PROVINCE)
    project = Projection(list(provinces.values()))
    speck = parse(
        "('32.79','Speck',-6.9,107.6,'[[[-6.9,107.6],[-6.90001,107.60001],[-6.9,107.60002],[-6.9,107.6]]]')",
        REGION,
    )["32.79"]

    path, box = to_path(speck, project)

    assert "h3v3h-3Z" in path
    assert box[2] - box[0] == pytest.approx(3, abs=0.11)
