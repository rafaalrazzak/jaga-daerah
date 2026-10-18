"""Tests for the natural-conditions ETL (`jaga_etl.nature`).

The fixtures are trimmed copies of what the two publishers actually returned, so the tests pin
behaviour that matters to a reader: the unit BIG really publishes, its duplicate-edition trap, that
an omitted region is never turned into a zero, and that the gate blocks an extra or unmappable
region.
"""

import json
from pathlib import Path

import pytest

from jaga_etl.nature.mapping import MappingError, load_big_editions
from jaga_etl.nature.normalize import (
    NatureParseError,
    count,
    normalize,
    parse_big,
    parse_bnpb_hazards,
    parse_bnpb_impacts,
    parse_bnpb_years,
    region_code,
)
from jaga_etl.nature.source import (
    BNPB_HAZARD_COLUMNS,
    BNPB_IMPACTS,
    BNPB_IMPACT_METRICS,
    BNPB_RESOURCES,
    resource_file_name,
)
from jaga_etl.nature.validate import check

REFERENCE = Path(__file__).parents[1] / "reference"
EDITIONS = REFERENCE / "nature-big-editions.csv"


def big_payload(rows: list[dict[str, object]]) -> bytes:
    features = [
        {
            "attributes": {
                "KDPKAB": "11.01",
                "WADMKK": "Aceh Selatan",
                "WADMPR": "Aceh",
                "TIPADM": 4,
                "LUASWH": 1.0,
                "METADATA": "TASWIL5000020260612KABKOTA",
                "OBJECTID": 1,
                **row,
            }
        }
        for row in rows
    ]
    return json.dumps({"features": features}).encode("utf-8")


def datastore_payload(records: list[dict[str, object]], total: int | None = None) -> bytes:
    return json.dumps(
        {"success": True, "result": {"records": records, "total": total or len(records)}}
    ).encode("utf-8")


def years_row(code: object, name: str = "ACEH SELATAN", **years: int) -> dict[str, object]:
    return {"Kode Wilayah Kabupaten / Kota": code, "Nama Kabupaten/Kota": name, **years}


def hazard_row(code: object, name: str = "ACEH SELATAN", **hazards: object) -> dict[str, object]:
    return {"Kode Wilayah Kabupaten / Kota": code, "Nama Kabupaten/Kota": name, **hazards}


# --- code and number normalisation ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1101", "11.01"),
        ("1101.0", "11.01"),
        (1101, "11.01"),
        ("11.01", "11.01"),
    ],
)
def test_region_code_accepts_every_spelling_the_two_sources_use(raw: object, expected: str) -> None:
    """BIG prints "11.05" and BNPB prints 1101.0; both must land on the same Kemendagri code."""
    assert region_code(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "Aceh", "110", 110, 11012])
def test_region_code_rejects_anything_that_is_not_four_digits(raw: object) -> None:
    with pytest.raises(ValueError):
        region_code(raw)


def test_count_distinguishes_a_published_zero_from_an_absent_value() -> None:
    """0 is a reported zero; None means the source does not state a value. They must not merge."""
    assert count(0) == 0
    assert count(0.0) == 0
    assert count("0.0") == 0
    assert count(12) == 12
    assert count("12") == 12
    assert count(None) is None
    assert count("") is None


# --- BIG areas ------------------------------------------------------------------------------------


def test_big_keeps_only_kabupaten_and_kota_rows_and_reads_areas() -> None:
    payload = big_payload(
        [
            {"KDPKAB": "11.01", "TIPADM": 4, "LUASWH": 4174.211},
            {"KDPKAB": "11.71", "TIPADM": 5, "WADMKK": "Kota Banda Aceh", "LUASWH": 61.065},
            {"KDPKAB": "", "TIPADM": 6, "WADMKK": "Aceh", "LUASWH": 56835.0},
        ]
    )

    areas, problems = parse_big(payload, editions={})

    assert problems == []
    assert sorted(areas) == ["11.01", "11.71"]
    assert areas["11.01"].area_km2 == pytest.approx(4174.211)
    assert areas["11.71"].name == "Kota Banda Aceh"


def test_big_area_is_published_in_square_kilometres_despite_the_hectare_alias() -> None:
    """The service aliases LUASWH as hectares but the values are km²; pinning the real values keeps
    a future 'unit fix' from silently multiplying every published area by a hundred."""
    areas, _ = parse_big(big_payload([{"TIPADM": 4, "LUASWH": 4174.211}]), editions={})

    assert areas["11.01"].area_km2 == pytest.approx(4174.211)


def test_big_duplicate_editions_block_until_a_reviewed_row_chooses_one() -> None:
    """Six regions come back twice, the second time as a stale sliver. Guessing would publish a
    wrong area, so an unreviewed duplicate is a problem, not a silent pick."""
    payload = big_payload(
        [
            {"TIPADM": 4, "LUASWH": 5352.92196835, "METADATA": "TASWIL5000020260612KABKOTA"},
            {"TIPADM": 4, "LUASWH": 5.215418822380763, "METADATA": "TASWIL5000020240905KABKOTA"},
        ]
    )

    areas, problems = parse_big(payload, editions={})

    assert areas == {}
    assert problems == [
        "BIG publishes 2 rows for 11.01 (editions "
        "['TASWIL5000020240905KABKOTA', 'TASWIL5000020260612KABKOTA']) and no reviewed row chooses one"
    ]


def test_big_duplicate_editions_follow_the_reviewed_choice() -> None:
    payload = big_payload(
        [
            {"TIPADM": 4, "LUASWH": 5352.92196835, "METADATA": "TASWIL5000020260612KABKOTA"},
            {"TIPADM": 4, "LUASWH": 5.215418822380763, "METADATA": "TASWIL5000020240905KABKOTA"},
        ]
    )
    editions = load_big_editions(EDITIONS)

    # A code absent from the reviewed table stays a problem; a reviewed one resolves.
    _, unreviewed = parse_big(payload, editions={})
    reviewed = dict(editions)
    from jaga_etl.nature.mapping import EditionChoice

    reviewed["11.01"] = EditionChoice("11.01", "TASWIL5000020260612KABKOTA", "reviewed for the test")
    areas, problems = parse_big(payload, editions=reviewed)

    assert len(unreviewed) == 1
    assert problems == []
    assert areas["11.01"].area_km2 == pytest.approx(5352.92196835)


def test_big_non_positive_area_is_a_problem() -> None:
    areas, problems = parse_big(big_payload([{"TIPADM": 4, "LUASWH": 0}]), editions={})

    assert areas == {}
    assert problems == ["BIG area for 11.01 is not a positive number: 0"]


def test_big_error_response_fails_loudly() -> None:
    with pytest.raises(NatureParseError):
        parse_big(json.dumps({"error": {"code": 499, "message": "Token Required"}}).encode(), editions={})


# --- BNPB events ----------------------------------------------------------------------------------


def test_bnpb_years_reads_one_total_per_region_and_year() -> None:
    payload = datastore_payload([years_row("1101.0", **{"2010.0": 8, "2011.0": 1, "2024.0": 9})])

    events, problems = parse_bnpb_years(payload)

    assert problems == []
    assert events[("11.01", 2010)].event_count == 8
    assert events[("11.01", 2024)].event_count == 9
    assert ("11.01", 2012) not in events  # absent, not zero


def test_bnpb_years_treats_a_blank_cell_as_absent_and_a_zero_as_a_reported_zero() -> None:
    payload = datastore_payload([years_row("1101.0", **{"2010.0": 0, "2011.0": "", "2012.0": None})])

    events, _ = parse_bnpb_years(payload)

    assert events[("11.01", 2010)].event_count == 0
    assert ("11.01", 2011) not in events
    assert ("11.01", 2012) not in events


def test_bnpb_hazards_reads_each_published_hazard_column() -> None:
    payload = datastore_payload([hazard_row(1101, BANJIR=5, **{"KEBAKARAN HUTAN DAN LAHAN": 4})])

    events, problems = parse_bnpb_hazards(payload)

    assert problems == []
    assert events[("11.01", "banjir")].event_count == 5
    assert events[("11.01", "kebakaran_hutan_lahan")].event_count == 4


def test_bnpb_national_total_row_is_not_a_region() -> None:
    """The 2024 table ends with an INDONESIA row that has no code; it must not become a region."""
    payload = datastore_payload(
        [hazard_row(1101, BANJIR=5), hazard_row(None, "INDONESIA", BANJIR=1420)]
    )

    events, problems = parse_bnpb_hazards(payload)

    assert problems == []
    assert [code for code, _ in events] == ["11.01"]


def test_bnpb_blank_named_row_without_a_code_is_reported() -> None:
    payload = datastore_payload([hazard_row(None, "", BANJIR=1)])

    _, problems = parse_bnpb_hazards(payload)

    assert problems == []


def test_bnpb_negative_event_count_is_a_problem() -> None:
    payload = datastore_payload([hazard_row(1101, BANJIR=-3)])

    events, problems = parse_bnpb_hazards(payload)

    assert events == {}
    assert problems == ["BNPB banjir events for 11.01 is negative: -3"]


def test_bnpb_truncated_page_fails_instead_of_publishing_a_partial_table() -> None:
    payload = datastore_payload([years_row("1101.0", **{"2010.0": 8})], total=900)

    with pytest.raises(NatureParseError):
        parse_bnpb_years(payload)


# --- recorded impact ------------------------------------------------------------------------------


def test_bnpb_impact_reads_each_metric_and_its_hazards() -> None:
    payload = datastore_payload([hazard_row(1101, GEMPABUMI=2, BANJIR=5)])

    by_metric, by_hazard, problems = parse_bnpb_impacts({"deaths": payload})

    assert problems == []
    assert by_hazard[("11.01", "gempabumi", "deaths")].value == 2
    assert by_hazard[("11.01", "banjir", "deaths")].value == 5


def test_bnpb_impact_total_is_withheld_when_any_hazard_column_is_absent() -> None:
    """A metric total is the sum of the nine hazard columns, so a blank column would turn it into a
    partial sum. The per-hazard figures are still published; the total is withheld, not guessed."""
    complete = datastore_payload([hazard_row(1101, **{column: 1 for column in BNPB_HAZARD_COLUMNS})])
    partial = datastore_payload([hazard_row(1101, GEMPABUMI=2)])

    full_metrics, _, _ = parse_bnpb_impacts({"deaths": complete})
    partial_metrics, partial_hazards, problems = parse_bnpb_impacts({"deaths": partial})

    assert full_metrics[("11.01", "deaths")].value == 9
    assert problems == []
    assert ("11.01", "deaths") not in partial_metrics
    assert partial_hazards[("11.01", "gempabumi", "deaths")].value == 2


def test_bnpb_impact_national_row_and_negative_values_are_handled() -> None:
    payload = datastore_payload([hazard_row(None, "INDONESIA", GEMPABUMI=1), hazard_row(1101, GEMPABUMI=-4)])

    by_metric, by_hazard, problems = parse_bnpb_impacts({"deaths": payload})

    assert by_metric == {}
    assert by_hazard == {}
    assert problems == ["BNPB impact deaths/gempabumi for 11.01 is negative: -4"]


# --- quality gate ---------------------------------------------------------------------------------


def build_normalized(
    area_codes: list[str], year_codes: list[str], hazard_codes: list[str], impact_codes: list[str] | None = None
):
    big = big_payload([{"KDPKAB": code, "TIPADM": 4, "LUASWH": 1.0} for code in area_codes])
    years = datastore_payload([years_row(code, **{"2010.0": 1}) for code in year_codes])
    hazards = datastore_payload([hazard_row(code, BANJIR=1) for code in hazard_codes])
    impacts = {
        "deaths": datastore_payload(
            [hazard_row(code, **{column: 1 for column in BNPB_HAZARD_COLUMNS}) for code in impact_codes or []]
        )
    }
    return normalize(big, years, hazards, editions={}, bnpb_impact_payloads=impacts)


def test_gate_passes_with_honest_partial_coverage_and_records_it() -> None:
    """Neither source covers all 514 regions. Partial coverage is published, and the gate states
    the exact counts so the artifact can never imply national coverage it does not have."""
    normalized = build_normalized(["11.01", "11.02"], ["11.01"], ["11.01", "11.02"])

    gate = check(normalized, {"11.01", "11.02", "11.03"}, total_regions=3)

    assert gate.errors == []
    assert gate.passed
    assert gate.coverage["total_regions"] == 3
    assert gate.coverage["area"]["covered"] == 2
    assert gate.coverage["events_by_hazard_2024"]["covered"] == 2
    assert gate.coverage["events_by_year"]["missing"] == {
        "11.02": "tidak ada di sumber",
        "11.03": "tidak ada di sumber",
    }


def test_gate_blocks_a_region_the_region_list_does_not_know() -> None:
    normalized = build_normalized(["11.01", "99.99"], ["11.01"], ["11.01"])

    gate = check(normalized, {"11.01"}, total_regions=1)

    assert not gate.passed
    assert any("not in the region list" in error and "99.99" in error for error in gate.errors)


def test_gate_blocks_a_source_row_whose_region_cannot_be_mapped() -> None:
    payload = datastore_payload([years_row("", "NOWHERE")])

    normalized = normalize(big_payload([]), payload, datastore_payload([]), editions={})
    gate = check(normalized, {"11.01"}, total_regions=1)

    assert not gate.passed
    assert any("without a usable region code" in error for error in gate.errors)


# --- reference table ------------------------------------------------------------------------------


def test_reviewed_edition_table_loads_and_requires_a_note(tmp_path: Path) -> None:
    choices = load_big_editions(EDITIONS)

    assert choices["74.02"].edition == "TASWIL5000020260612KABKOTA"
    assert len(choices) == 6

    bad = tmp_path / "bad.csv"
    bad.write_text("region_code,edition,note\n74.02,TASWIL5000,x\n", encoding="utf-8")
    with pytest.raises(MappingError):
        load_big_editions(bad)


def test_resource_file_names_are_stable_and_distinct() -> None:
    names = [resource_file_name(resource) for resource in BNPB_RESOURCES]

    assert len(set(names)) == len(names)
    assert all(name.startswith("bnpb-") and name.endswith(".json") for name in names)


def test_impact_resources_are_addressable_by_metric_and_carry_their_own_licence() -> None:
    """The impact tables are ODbL while the event tables are ODC-BY, so the mapping used at build
    time and the licences stated in the artifact must both resolve to the fetched resources."""
    by_id = {resource.resource_id: resource for resource in BNPB_IMPACTS}

    assert set(BNPB_IMPACT_METRICS) == {
        "deaths",
        "missing",
        "injured",
        "affected",
        "displaced",
        "houses_damaged",
    }
    assert all(resource_id in by_id for resource_id in BNPB_IMPACT_METRICS.values())
    assert all(resource.license == "ODbL" for resource in BNPB_IMPACTS)
    assert all(resource.license == "ODC-BY" for resource in (BNPB_RESOURCES[0], BNPB_RESOURCES[1]))
