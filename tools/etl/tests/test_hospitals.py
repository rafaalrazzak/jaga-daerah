import json
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key
from jaga_etl.places.build import _hospitals, _school_key, geometry_contains

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}
OTHER = {"type": "Polygon", "coordinates": [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]}
WITH_HOLE = {
    "type": "Polygon",
    "coordinates": [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]],
    ],
}


def test_point_inside_square_and_outside_a_hole() -> None:
    assert geometry_contains(SQUARE, 1, 1)
    assert not geometry_contains(SQUARE, 3, 1)
    assert geometry_contains(WITH_HOLE, 0.5, 0.5)
    assert not geometry_contains(WITH_HOLE, 2, 2)


def _write(path: Path, rows: list[dict[str, str]]) -> Path:
    target = path / "sirs.json"
    target.write_text(json.dumps({"data": rows}), encoding="utf-8")
    return target


def test_spelling_alias_counts_the_one_official_region(tmp_path: Path) -> None:
    source = _write(
        tmp_path,
        [{"nama_prop": "Sumatera Utara", "kab": "Toba Samosir", "jenis": "RSU", "kode": "1"}],
    )
    counts, omitted = _hospitals(
        source,
        {name_key("Sumatera Utara"): ("12", "Sumatera Utara")},
        {("12", _school_key("Kabupaten Toba")): "12.12"},
    )
    assert omitted == 0
    assert counts["12.12"]["total"] == 1


def test_coordinate_assigns_only_the_polygon_that_contains_the_point(tmp_path: Path) -> None:
    source = _write(
        tmp_path,
        [{"nama_prop": "Jawa Barat", "kab": "Bandung", "jenis": "RSIA", "kode": "9"}],
    )
    provinces = {name_key("Jawa Barat"): ("32", "Jawa Barat")}
    regions = {
        ("32", _school_key("Kabupaten Bandung")): "32.04",
        ("32", _school_key("Kota Bandung")): "32.73",
    }
    boundaries = {"32.04": OTHER, "32.73": SQUARE}
    counts, omitted = _hospitals(source, provinces, regions, {"9": (1.0, 1.0)}, boundaries)
    assert omitted == 0
    assert counts["32.73"] == {"total": 1, "umum": 0, "ibu_anak": 1, "khusus": 0}
    assert "32.04" not in counts


def test_coordinate_outside_both_shapes_stays_omitted(tmp_path: Path) -> None:
    source = _write(
        tmp_path,
        [{"nama_prop": "Jawa Barat", "kab": "Bandung", "jenis": "RSU", "kode": "9"}],
    )
    provinces = {name_key("Jawa Barat"): ("32", "Jawa Barat")}
    regions = {
        ("32", _school_key("Kabupaten Bandung")): "32.04",
        ("32", _school_key("Kota Bandung")): "32.73",
    }
    counts, omitted = _hospitals(
        source, provinces, regions, {"9": (9.0, 9.0)}, {"32.04": OTHER, "32.73": SQUARE}
    )
    assert omitted == 1
    assert counts == {}
