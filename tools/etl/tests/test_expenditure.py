"""Tests for the offline expenditure-breakdown web export (`jaga_etl.expenditure`).

Offline only: the fixtures are the same deterministic DJPK snapshot the fact tests use, sealed on
disk. The behaviour under test is what a reader depends on — that the static page and the API agree
about status, that a blank source cell never becomes a zero, and that an unreconciled jenis BLOCKS
publication rather than shipping a breakdown that does not add up.
"""

from decimal import Decimal
from pathlib import Path

import pytest
from facts_fixtures import (
    EXPENDITURES,
    PROVINCES,
    REGIONS,
    UNRECONCILED_EXPENDITURES,
    YEARS,
    djpk_contents,
)

from jaga_etl.expenditure.build import (
    EXPENDITURE_LABELS,
    JENIS_COUNT,
    QualityGateError,
    build,
    check,
    rupiah,
    share_percent,
)
from jaga_etl.facts.djpk.mapping import RegionMatcher, read_aliases
from jaga_etl.facts.djpk.normalize import normalize as normalize_djpk
from jaga_etl.facts.validate import collect_djpk_facts
from jaga_etl.snapshot import Manifest

ALIASES = read_aliases(Path(__file__).parents[1] / "reference" / "djpk-aliases.csv")
NAMES = {region.code: region.name for region in REGIONS}


def matcher() -> RegionMatcher:
    return RegionMatcher(PROVINCES, REGIONS, ALIASES)


def facts_for(expenditures=EXPENDITURES):
    result, _ = collect_djpk_facts(normalize_djpk(djpk_contents(expenditures=expenditures), YEARS), matcher())
    return result


def manifest():
    """A manifest shaped like the sealed snapshot's, so the artifact's provenance path is exercised
    without writing anything to disk."""
    return Manifest(
        source="djpk",
        created_at="2026-10-17T09:59:32.021692+00:00",
        sealed=True,
        files=[],
    )


class TestMoneyFormatting:
    def test_rupiah_is_a_two_place_decimal_string_and_null_stays_null(self):
        assert rupiah(Decimal("8345231335444.9")) == "8345231335444.90"
        assert rupiah(Decimal("0")) == "0.00"
        assert rupiah(None) is None

    def test_share_percent_is_one_decimal_in_exact_integer_arithmetic(self):
        assert share_percent(Decimal("600.00"), Decimal("1000.00")) == "60.0"
        assert share_percent(Decimal("500.00"), Decimal("800.00")) == "62.5"
        # Rounding is half up, matching the API's sharePercent.
        assert share_percent(Decimal("1.00"), Decimal("3.00")) == "33.3"
        assert share_percent(Decimal("2.00"), Decimal("3.00")) == "66.7"

    def test_a_zero_or_unavailable_total_yields_no_share_rather_than_zero_percent(self):
        assert share_percent(Decimal("100.00"), Decimal("0.00")) is None
        assert share_percent(None, Decimal("100.00")) is None
        assert share_percent(Decimal("100.00"), None) is None


class TestArtifact:
    def test_publishes_one_module_per_region_year_with_labels_and_shares(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        bandung = result.payload["regions"]["32.73"]
        assert bandung["name"] == "Kota Bandung"
        assert sorted(bandung["years"]) == ["2024", "2025"]
        module = bandung["years"]["2025"]
        assert set(module) == {"status", "total_budget_amount", "total_realization_amount", "by_type", "narrative"}
        row = module["by_type"][0]
        assert set(row) == {
            "type",
            "label",
            "budget_amount",
            "realization_amount",
            "budget_share_percent",
            "realization_share_percent",
        }
        assert row["label"] == EXPENDITURE_LABELS[row["type"]]

    def test_rows_are_ordered_by_largest_realisation_with_unknown_amounts_last(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        rows = result.payload["regions"]["32.73"]["years"]["2024"]["by_type"]
        realizations = [
            None if row["realization_amount"] is None else Decimal(row["realization_amount"])
            for row in rows
        ]
        known = [value for value in realizations if value is not None]
        assert known == sorted(known, reverse=True)
        # Every None must sit after every known value.
        first_none = next((i for i, v in enumerate(realizations) if v is None), len(realizations))
        assert all(v is None for v in realizations[first_none:])

    def test_a_blank_source_amount_is_null_not_zero(self):
        expenditures = {
            **UNRECONCILED_EXPENDITURES,
            ("10", "01"): [
                ("Belanja Pegawai", "1000", ""),
                ("Belanja Barang dan Jasa", "", ""),
            ],
        }

        result = build(facts_for(expenditures), NAMES, manifest(), YEARS, "fixture")

        rows = {row["type"]: row for row in result.payload["regions"]["32.04"]["years"]["2024"]["by_type"]}
        assert rows["belanja_pegawai"]["realization_amount"] is None
        assert rows["belanja_pegawai"]["budget_amount"] == "1000.00"
        assert rows["belanja_barang_dan_jasa"]["budget_amount"] is None

    def test_a_reported_zero_is_kept_as_zero(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        # Kota Banda Aceh's fixture declares 1e12 budget and an explicit 0 realisasi for pegawai.
        rows = {row["type"]: row for row in result.payload["regions"]["11.71"]["years"]["2025"]["by_type"]}
        assert rows["belanja_pegawai"]["realization_amount"] == "0.00"
        # The region's own published realization total is also 0, so the share is "data tidak cukup"
        # (NULL) rather than 0%: dividing by a zero total is undefined, exactly as the API decides.
        assert rows["belanja_pegawai"]["realization_share_percent"] is None
        assert rows["belanja_pegawai"]["budget_share_percent"] == "66.7"

    def test_narrative_describes_what_the_table_actually_shows(self):
        # A region-year with fewer than ten jenis omits the unreported ones from the table; the
        # narrative must not claim they are rendered as "Data belum tersedia", which is the wording
        # for a blank CELL, not a missing row.
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        module = result.payload["regions"]["32.73"]["years"]["2025"]
        assert len(module["by_type"]) < JENIS_COUNT
        assert "tidak ditampilkan" in module["narrative"][0]

    def test_status_matches_the_api_rule_exactly(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        for code, region in result.payload["regions"].items():
            for year, module in region["years"].items():
                amounts = [
                    value
                    for row in module["by_type"]
                    for value in (row["budget_amount"], row["realization_amount"])
                ]
                if not module["by_type"]:
                    expected = "unavailable"
                elif any(value is None for value in amounts):
                    expected = "partial"
                else:
                    expected = "complete"
                assert module["status"] == expected, f"{code} {year}"

    def test_source_block_carries_the_provenance_and_the_documented_caveats(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "20261017T094824Z")

        source = result.payload["source"]
        assert source["publisher"] == "DJPK Kemenkeu"
        assert source["url"].startswith("https://djpk.kemenkeu.go.id/")
        assert source["snapshot_id"] == "20261017T094824Z"
        assert source["snapshot_checksum"]
        assert source["processed_at"]
        assert source["dataset_version"].endswith(source["snapshot_checksum"][:8])
        # The rounding caveat and the murni/perubahan ambiguity the repo documents must travel with
        # the figures, not live only in the UI copy.
        assert "membulatkan" in source["rounding_note"]
        assert "murni" in source["murni_perubahan_note"] and "perubahan" in source["murni_perubahan_note"]
        assert "bukan belanja per program" in source["scope_note"]
        assert source["jenis_count"] == JENIS_COUNT == len(EXPENDITURE_LABELS)

    def test_coverage_reports_reconciliation_against_the_tolerance(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        assert result.coverage["region_years"] > 0
        assert Decimal(result.coverage["max_abs_difference"]) <= Decimal(result.coverage["tolerance"])
        assert result.coverage["tolerance"] == "1.00"


class TestBlockingGate:
    def test_an_unreconciled_jenis_blocks_publication(self):
        expenditures = {
            **UNRECONCILED_EXPENDITURES,
            # One jenis short of the published total for Kab. Bandung.
            ("10", "01"): [("Belanja Pegawai", "1", "1")],
        }

        with pytest.raises(QualityGateError) as error:
            build(facts_for(expenditures), NAMES, manifest(), YEARS, "fixture")

        assert any("jenis belanja anggaran for 32.04" in problem for problem in error.value.problems)

    def test_the_tolerance_is_not_so_loose_that_a_missing_jenis_passes(self):
        # A gap of one whole rupiah is tolerated (source rounding); a gap of many millions is not.
        expenditures = {
            **UNRECONCILED_EXPENDITURES,
            ("10", "01"): [("Belanja Pegawai", "2000000000000", "0")],
        }

        with pytest.raises(QualityGateError):
            build(facts_for(expenditures), NAMES, manifest(), YEARS, "fixture")

    def test_an_unmatched_pemda_blocks_before_any_artifact_is_built(self):
        budgets = {("10", "99"): ("Kota Atlantis", "1", "1", "100.00")}
        contents = djpk_contents(budgets)
        result, _ = collect_djpk_facts(normalize_djpk(contents, YEARS), matcher())

        assert any("unmatched DJPK pemda" in problem and "Kota Atlantis" in problem for problem in result.errors)


class TestArtifactCheck:
    def test_check_accepts_the_published_payload(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")

        assert check(result.payload) == []

    def test_check_rejects_an_unknown_jenis(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")
        result.payload["regions"]["32.73"]["years"]["2025"]["by_type"][0]["type"] = "belanja_lainnya"

        assert any("unknown jenis" in problem for problem in check(result.payload))

    def test_check_rejects_a_malformed_amount(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")
        result.payload["regions"]["32.73"]["years"]["2025"]["by_type"][0]["budget_amount"] = "1.5"

        assert any("is not a rupiah string" in problem for problem in check(result.payload))

    def test_check_rejects_a_complete_status_with_a_missing_amount(self):
        result = build(facts_for(), NAMES, manifest(), YEARS, "fixture")
        module = result.payload["regions"]["32.73"]["years"]["2025"]
        module["status"] = "complete"
        module["by_type"][0]["budget_amount"] = None

        assert any("status is complete but a jenis amount is missing" in problem for problem in check(result.payload))
