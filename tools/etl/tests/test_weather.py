"""Tests for the BMKG normal-rainfall climatology module.

The gate is the risky part: it decides whether a value that belongs to a neighbouring region, or to
no covered raster cell at all, can reach a public profile. These tests exercise that decision, the
point-in-polygon test it depends on, and the month parsing, using small fixtures rather than the
sealed snapshot (which is not in version control).
"""

import json
from pathlib import Path

import pytest

from jaga_etl.boundaries.build import Boundary
from jaga_etl.weather.build import (
    MONTH_NAMES,
    QualityGateError,
    SamplePoint,
    build_records,
    candidate_points,
    check_points,
    check_snapshot_urls,
    inside,
    parse_identify,
    read_reference,
    ring_area,
    ring_centroid,
    write_reference,
)
from jaga_etl.weather.source import MONTH_LAYERS, identify_url

SQUARE = [(0.0, 0.0), (0.0, 2.0), (2.0, 2.0), (2.0, 0.0)]
# A crescent: its area centroid falls outside the shape, which is why interior candidates exist.
CRESCENT = [
    (0.0, 0.0),
    (0.0, 6.0),
    (1.0, 6.0),
    (1.0, 1.0),
    (5.0, 1.0),
    (5.0, 0.0),
]


def boundary(code: str, ring: list[tuple[float, float]]) -> Boundary:
    return Boundary(code=code, name=code, lat=ring[0][0], lng=ring[0][1], polygons=[[ring]])


def identify_payload(values: list[object]) -> bytes:
    """One identify response in the shape the ArcGIS endpoint returns (a result per month layer)."""
    return json.dumps(
        {
            "results": [
                {
                    "layerId": layer,
                    "layerName": f"month {layer}",
                    "attributes": {"Pixel Value": value},
                }
                for layer, value in zip(MONTH_LAYERS, values, strict=True)
            ]
        }
    ).encode()


def point(code: str, latitude: float, longitude: float, method: str = "centroid") -> SamplePoint:
    return SamplePoint(code=code, latitude=latitude, longitude=longitude, method=method, note="uji")


class TestGeometry:
    def test_inside_accepts_an_interior_point_and_rejects_an_outside_one(self) -> None:
        assert inside((1.0, 1.0), SQUARE)
        assert not inside((3.0, 1.0), SQUARE)

    def test_inside_handles_the_seam_between_the_last_and_first_vertex(self) -> None:
        # The edge from the last vertex back to the first crosses the ray only if the wrap index is
        # computed correctly; a wrong index silently drops it and flips the answer for these points.
        below_first_edge = (0.5, 1.0)
        assert inside(below_first_edge, SQUARE)

    def test_ring_centroid_is_in_latitude_longitude_order(self) -> None:
        # A square from (lat 0, lng 0) to (lat 2, lng 10) must not report a centroid near (lng 2).
        ring = [(0.0, 0.0), (0.0, 10.0), (2.0, 10.0), (2.0, 0.0)]

        centroid = ring_centroid(ring)

        assert centroid == pytest.approx((1.0, 5.0))
        assert inside(centroid, ring)

    def test_degenerate_ring_has_no_centroid(self) -> None:
        assert ring_centroid([(1.0, 1.0), (1.0, 1.0)]) is None
        assert ring_area([(1.0, 1.0), (1.0, 1.0)]) == 0

    def test_candidate_points_avoid_a_centroid_outside_a_crescent(self) -> None:
        candidates = candidate_points(boundary("99.01", CRESCENT))

        assert candidates, "a crescent still needs an interior candidate"
        assert all(inside(position, CRESCENT) for position, _ in candidates)
        assert all(method in ("centroid", "interior") for _, method in candidates)


class TestParsing:
    def test_months_are_keyed_by_layer_id_not_by_response_order(self) -> None:
        # The service documents layers 0-11 as January-December; a shuffled response must still land
        # on the right month, because the published table reads `monthly_mm` by index.
        payload = json.dumps(
            {
                "results": [
                    {"layerId": 11, "attributes": {"Pixel Value": "245.577045"}},
                    {"layerId": 0, "attributes": {"Pixel Value": "231.872760"}},
                ]
            }
        ).encode()

        layers = parse_identify(payload)

        assert layers[0] == pytest.approx(231.872760)
        assert layers[11] == pytest.approx(245.577045)

    def test_nodata_is_none_never_zero(self) -> None:
        payload = json.dumps(
            {"results": [{"layerId": 0, "attributes": {"Pixel Value": "NoData"}}]}
        ).encode()

        assert parse_identify(payload)[0] is None

    def test_an_error_response_is_rejected_rather_than_read_as_empty(self) -> None:
        with pytest.raises(ValueError, match="error"):
            parse_identify(b'{"error": {"code": 400, "message": "bad geometry"}}')


class TestQualityGate:
    def test_missing_region_blocks_the_build(self) -> None:
        regions = {"32.73": boundary("32.73", SQUARE)}
        problems = check_points({"32.73": point("32.73", 1.0, 1.0)}, regions, {"32.73", "32.74"})

        assert any("32.74" in problem for problem in problems)

    def test_sample_point_outside_its_own_boundary_blocks_the_build(self) -> None:
        regions = {"32.73": boundary("32.73", SQUARE)}
        problems = check_points({"32.73": point("32.73", 40.0, 40.0)}, regions, {"32.73"})

        assert problems == ["32.73: sample point is outside its own boundary"]

    def test_two_regions_sharing_one_point_block_the_build(self) -> None:
        regions = {"32.73": boundary("32.73", SQUARE), "32.74": boundary("32.74", SQUARE)}
        shared = {"32.73": point("32.73", 1.0, 1.0), "32.74": point("32.74", 1.0, 1.0)}

        problems = check_points(shared, regions, {"32.73", "32.74"})

        assert any("same sample point" in problem for problem in problems)

    def test_snapshot_fetched_at_a_different_point_blocks_the_build(self) -> None:
        from jaga_etl.snapshot import Manifest, SnapshotFile

        reference = {"32.73": point("32.73", -6.9, 107.6)}
        manifest = Manifest(
            source="bmkg-weather",
            created_at="2026-10-17T10:00:00+00:00",
            sealed=True,
            files=[
                SnapshotFile(
                    name="region-32.73.json",
                    url=identify_url(-6.5, 107.6),  # a different latitude than the reference
                    sha256="0" * 64,
                    bytes=10,
                    fetched_at="2026-10-17T10:00:00+00:00",
                )
            ],
        )

        assert check_snapshot_urls(reference, manifest, {"32.73"}) == [
            "32.73: snapshot response was fetched at a different sample point"
        ]

    def test_a_response_at_the_reference_point_passes(self) -> None:
        from jaga_etl.snapshot import Manifest, SnapshotFile

        reference = {"32.73": point("32.73", -6.919823, 107.637039)}
        manifest = Manifest(
            source="bmkg-weather",
            created_at="2026-10-17T10:00:00+00:00",
            sealed=True,
            files=[
                SnapshotFile(
                    name="region-32.73.json",
                    url=identify_url(-6.919823, 107.637039),
                    sha256="0" * 64,
                    bytes=10,
                    fetched_at="2026-10-17T10:00:00+00:00",
                )
            ],
        )

        assert check_snapshot_urls(reference, manifest, {"32.73"}) == []

    def test_all_nodata_is_published_as_unavailable_not_as_zero(self) -> None:
        reference = {"32.73": point("32.73", 1.0, 1.0)}
        contents = {"region-32.73.json": identify_payload(["NoData"] * 12)}

        records, unavailable, problems = build_records(reference, contents, {"32.73"})

        assert problems == []
        assert records == {}
        assert "32.73" in unavailable

    def test_one_nodata_month_blocks_the_build(self) -> None:
        # A partially covered cell would otherwise publish a total that silently omits a month.
        reference = {"32.73": point("32.73", 1.0, 1.0)}
        contents = {"region-32.73.json": identify_payload([100.0] * 5 + ["NoData"] + [100.0] * 6)}

        records, unavailable, problems = build_records(reference, contents, {"32.73"})

        assert records == {} and unavailable == {}
        assert any("Juni" in problem for problem in problems)

    def test_a_missing_snapshot_response_blocks_the_build(self) -> None:
        records, unavailable, problems = build_records(
            {"32.73": point("32.73", 1.0, 1.0)}, {}, {"32.73"}
        )

        assert records == {} and unavailable == {}
        assert problems == ["32.73: no identify response in the snapshot"]

    def test_published_total_equals_the_sum_of_the_published_months(self) -> None:
        # The table prints twelve rounded months and a total beneath them, so the total must be the
        # sum of exactly those printed values: summing full precision instead leaves the column not
        # adding up to its own footer (observed up to 0.3 mm out over 312 of 510 regions).
        values = [10.04, 20.06, 30.05, 40.04, 50.06, 60.05, 70.04, 80.06, 90.05, 100.04, 110.06, 120.05]
        reference = {"32.73": point("32.73", 1.0, 1.0)}

        records, _, problems = build_records(
            reference, {"region-32.73.json": identify_payload(values)}, {"32.73"}
        )

        assert problems == []
        record = records["32.73"]
        assert record["annual_mm"] == round(sum(record["monthly_mm"].values()), 1)
        assert all(value == round(value, 1) for value in record["monthly_mm"].values())

    def test_published_record_carries_the_months_the_total_and_the_point(self) -> None:
        values = [10.0 + index for index in range(12)]
        reference = {"32.73": point("32.73", 1.0, 1.0)}

        records, unavailable, problems = build_records(
            reference, {"region-32.73.json": identify_payload(values)}, {"32.73"}
        )

        assert problems == [] and unavailable == {}
        record = records["32.73"]
        # Keyed by month name: the value states which month it is, and the record is a mapping rather
        # than a positional array, so a reader never has to know the layer order.
        assert record["monthly_mm"] == {
            name: float(value) for name, value in zip(MONTH_NAMES, values, strict=True)
        }
        assert record["annual_mm"] == pytest.approx(sum(values))
        assert record["sample_point"] == {
            "latitude": 1.0,
            "longitude": 1.0,
            "method": "centroid",
            "note": "uji",
        }

    def test_gate_error_reports_every_problem_at_once(self) -> None:
        error = QualityGateError(["a", "b", "c"])

        assert error.problems == ["a", "b", "c"]
        assert "3 problem(s)" in str(error)


class TestReferenceFile:
    def test_round_trips_the_reviewed_sample_points(self, tmp_path: Path) -> None:
        path = tmp_path / "points.csv"
        points = {
            "32.73": point("32.73", -6.919823, 107.637039),
            "11.01": point("11.01", 3.161651, 97.436544, method="interior"),
        }

        write_reference(path, points)

        assert path.read_text(encoding="utf-8").splitlines()[0] == "code,latitude,longitude,method,note"
        assert read_reference(path) == points

    def test_url_is_built_from_the_point_it_will_be_fetched_at(self) -> None:
        url = identify_url(-6.919823, 107.637039)

        assert url.startswith("https://gis.bmkg.go.id/arcgis/rest/services/")
        assert "%22x%22%3A107.637039" in url
        assert "geometryType=esriGeometryPoint" in url
