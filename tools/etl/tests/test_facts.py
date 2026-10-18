from decimal import Decimal
from pathlib import Path

import pytest

from facts_fixtures import (
    BUDGETS,
    EXPENDITURES,
    PROVINCES,
    REGIONS,
    UNRECONCILED_EXPENDITURES,
    YEARS,
    bnpb_contents,
    djpk_contents,
    spreadsheet,
    write_snapshot,
)
from jaga_etl.facts.bnpb.normalize import normalize as normalize_bnpb
from jaga_etl.facts.djpk.mapping import Alias, RegionMatcher, name_key, read_aliases
from jaga_etl.facts.djpk.normalize import normalize as normalize_djpk
from jaga_etl.facts.djpk.normalize import expenditure_rows, parse_amount, parse_rows
from jaga_etl.facts.validate import EXPENDITURE_TOLERANCE, PreviousVersion, run_gate
from jaga_etl.snapshot import SnapshotError, SnapshotWriter, read_snapshot

ALIASES = read_aliases(Path(__file__).parents[1] / "reference" / "djpk-aliases.csv")
PROVINCE_CODES = {p.code for p in PROVINCES}


def matcher(aliases: list[Alias] = ALIASES) -> RegionMatcher:
    return RegionMatcher(PROVINCES, REGIONS, aliases)


def gate(djpk_files: dict[str, bytes] | None = None, bnpb_files: dict[str, bytes] | None = None, **kwargs):
    return run_gate(
        normalize_djpk(djpk_files or djpk_contents(), YEARS),
        normalize_bnpb(bnpb_files or bnpb_contents()),
        matcher(),
        REGIONS,
        PROVINCE_CODES,
        YEARS,
        kwargs.pop("previous", None),
        **kwargs,
    )


class TestSnapshots:
    def test_seals_files_with_checksums_and_refuses_to_overwrite(self, tmp_path: Path):
        directory = write_snapshot(tmp_path, "djpk", {"a.xml": b"one"}, "s1")

        manifest, contents = read_snapshot(directory)

        assert contents == {"a.xml": b"one"}
        assert len(manifest.checksum) == 64
        with pytest.raises(SnapshotError):
            SnapshotWriter(tmp_path, "djpk", "s1")

    def test_detects_tampered_raw_files(self, tmp_path: Path):
        directory = write_snapshot(tmp_path, "bnpb", {"a.json": b"{}"}, "s1")
        (directory / "a.json").write_bytes(b"{ }")

        with pytest.raises(SnapshotError):
            read_snapshot(directory)

    @pytest.mark.parametrize("name", ["../x", "a/b", "manifest.json", ""])
    def test_rejects_unsafe_file_names(self, tmp_path: Path, name: str):
        with pytest.raises(SnapshotError):
            SnapshotWriter(tmp_path, "djpk", "s1").add(name, "https://example.test", b"")


class TestDjpkParsing:
    def test_amounts_keep_cents_and_flag_reduced_precision(self):
        assert parse_amount("7490617461211.1") == (Decimal("7490617461211.10"), False)
        assert parse_amount("1.4119369592191E+14") == (Decimal("141193695921910.00"), True)
        assert parse_amount("0") == (Decimal("0.00"), False)
        assert parse_amount("") == (None, False)

    @pytest.mark.parametrize("text", ["-1", "abc", "NaN", "Infinity"])
    def test_rejects_invalid_amounts(self, text: str):
        with pytest.raises(ValueError):
            parse_amount(text)

    def test_reads_spreadsheetml_rows(self):
        rows = parse_rows(spreadsheet([("Belanja Daerah", "10", "5", "50.00")]))

        assert rows == [["Akun", "Anggaran", "Realisasi", "Persentase"], ["Belanja Daerah", "10", "5", "50.00"]]

    def test_refuses_xml_entity_expansion(self):
        bomb = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><x>&b;</x>'

        with pytest.raises(Exception):
            parse_rows(bomb)

    def test_normalizes_one_record_per_pemda_and_year(self):
        result = normalize_djpk(djpk_contents(), YEARS)

        assert result.rejections == []
        assert len(result.records) == len(BUDGETS) * len(YEARS)
        bandung = next(r for r in result.records if r.djpk_pemda_name == "Kota Bandung" and r.year == 2025)
        assert bandung.budget_amount == Decimal("8345231335444.90")
        assert bandung.realization_amount == Decimal("7490617461211.10")

    def test_missing_belanja_row_is_null_not_zero(self):
        budgets = {**BUDGETS, ("10", "17"): None}

        result = normalize_djpk(djpk_contents(budgets), YEARS)

        partial = [r for r in result.records if r.djpk_pemda_code == "17"]
        assert {r.budget_amount for r in partial} == {None}
        zero = next(r for r in result.records if r.djpk_pemda_code == "15")
        assert zero.realization_amount == Decimal("0.00")

    def test_rejects_rows_whose_percentage_contradicts_the_amounts(self):
        budgets = {**BUDGETS, ("10", "17"): ("Kota Bandung", "100", "50", "75.00")}

        result = normalize_djpk(djpk_contents(budgets), YEARS)

        assert any("reported 75.00%" in rejection for rejection in result.rejections)


class TestExpenditureParsing:
    def test_maps_every_jenis_label_to_its_stable_value_once(self):
        rows = parse_rows(
            spreadsheet(
                [
                    ("Belanja Daerah", "100", "100", "100.00"),
                    ("Belanja Pegawai", "40", "40", "100.00"),
                    ("Belanja Pegawai", "40", "40", "100.00"),
                    ("Belanja Barang dan Jasa", "30", "30", "100.00"),
                    ("Belanja Lainnya", "30", "30", "100.00"),
                    ("Belanja Hibah", "30", "30", "100.00"),
                    ("Pembiayaan Daerah", "0", "0", "0"),
                ]
            )
        )

        assert expenditure_rows(rows) == [
            ("belanja_pegawai", Decimal("40.00"), Decimal("40.00")),
            ("belanja_barang_dan_jasa", Decimal("30.00"), Decimal("30.00")),
            ("belanja_hibah", Decimal("30.00"), Decimal("30.00")),
        ]

    def test_rejects_an_unknown_belanja_account(self):
        rows = parse_rows(
            spreadsheet(
                [
                    ("Belanja Daerah", "100", "100", "100.00"),
                    ("Belanja Misterius", "100", "100", "100.00"),
                ]
            )
        )

        with pytest.raises(ValueError, match="unknown expenditure account"):
            expenditure_rows(rows)

    def test_rejects_a_repeated_jenis_with_different_amounts(self):
        rows = parse_rows(
            spreadsheet(
                [
                    ("Belanja Daerah", "100", "100", "100.00"),
                    ("Belanja Hibah", "60", "60", "100.00"),
                    ("Belanja Hibah", "70", "70", "100.00"),
                ]
            )
        )

        with pytest.raises(ValueError, match="appears with different amounts"):
            expenditure_rows(rows)

    def test_blank_jenis_amounts_stay_null_rather_than_zero(self):
        rows = parse_rows(
            spreadsheet(
                [
                    ("Belanja Daerah", "100", "100", "100.00"),
                    ("Belanja Tidak Terduga", "", "", ""),
                ]
            )
        )

        assert expenditure_rows(rows) == [("belanja_tidak_terduga", None, None)]

    def test_normalize_emits_one_record_per_jenis_and_pemda_year(self):
        result = normalize_djpk(djpk_contents(), YEARS)

        assert result.rejections == []
        assert len(result.expenditures) == (6 + 3 + 3) * len(YEARS)
        pegawai = [
            r for r in result.expenditures if r.djpk_pemda_name == "Kota Bandung" and r.expenditure_type == "belanja_pegawai"
        ]
        assert len(pegawai) == len(YEARS)


class TestMapping:
    @pytest.mark.parametrize(
        ("left", "right"),
        [
            ("Kab. Bandung", "Kabupaten Bandung"),
            ("Kota Bau-Bau", "Kota Baubau"),
            ("Provinsi Jawa Barat", "Jawa Barat"),
            ("Kota Administrasi Jakarta Utara", "Kota Jakarta Utara"),
        ],
    )
    def test_name_key_ignores_formatting(self, left: str, right: str):
        assert name_key(left) == name_key(right)

    def test_matches_exactly_then_by_reviewed_alias(self):
        m = matcher(
            [*ALIASES, Alias("region", "10", "Kab. Bandung Lama", "32.04", "renamed")]
        )
        province = m.province("10", "Provinsi Jawa Barat")

        assert province is not None
        assert m.region("10", province, "Kota Bandung") == type(province)("32.73", "exact")
        assert m.region("10", province, "Kab. Bandung Lama") == type(province)("32.04", "alias")
        assert m.region("10", province, "Kota Atlantis") is None


class TestBnpb:
    def test_normalizes_province_type_rows_and_keeps_blank_as_null(self):
        result = normalize_bnpb(bnpb_contents())

        assert result.rejections == []
        assert len(result.records) == len(PROVINCES) * 9 * len(YEARS)
        tsunami_aceh = next(
            r for r in result.records if (r.province_code, r.year, r.disaster_type) == ("11", 2025, "tsunami")
        )
        assert tsunami_aceh.event_count is None
        assert tsunami_aceh.missing == 0

    def test_rejects_negative_counts(self):
        files = bnpb_contents()
        name = next(iter(files))
        files[name] = files[name].replace(b'"BANJIR": ', b'"BANJIR": -', 1)

        assert any("negative" in item for item in normalize_bnpb(files).rejections)


class TestGate:
    def test_complete_fixture_passes_with_counts_and_totals(self):
        result = gate()

        assert result.errors == []
        assert len(result.budget_facts) == 6
        assert len(result.disaster_facts) == 36
        djpk_report = result.report["djpk"]
        assert djpk_report["zero_counts"]["realization_amount"] == 2
        assert djpk_report["reduced_precision_rows"] == 2

    def test_expenditure_breakdown_sums_to_the_published_total(self):
        result = gate()

        assert result.errors == []
        breakdown = result.report["djpk"]["expenditure_breakdown"]
        # Nine distinct jenis across the three fixture pemda, twice (2024 and 2025).
        assert breakdown["rows"] == (6 + 3 + 3) * 2
        assert breakdown["reconciled_region_years"] == 6
        # Kota Bandung's real 2025 rounding: Rp0.03 short of the published total, within tolerance.
        assert Decimal(breakdown["max_abs_difference"]) <= EXPENDITURE_TOLERANCE

    def test_blocks_when_jenis_subtotals_miss_the_total(self):
        result = gate(djpk_contents(expenditures=UNRECONCILED_EXPENDITURES))

        assert not result.passed
        assert any("jenis belanja anggaran for 32.04" in error for error in result.errors)

    def test_failed_expenditure_gate_leaves_no_expenditure_rows(self):
        result = gate(djpk_contents(expenditures=UNRECONCILED_EXPENDITURES))

        # The gate blocks before staging, so the caller never receives rows to write.
        assert not result.passed

    def test_fails_when_a_pemda_cannot_be_mapped(self):
        budgets = {**BUDGETS, ("10", "99"): ("Kota Atlantis", "1", "1", "100.00")}

        result = gate(djpk_contents(budgets))

        assert any("unmatched DJPK pemda" in error and "Kota Atlantis" in error for error in result.errors)

    def test_fails_when_provinces_do_not_add_up_to_the_national_total(self):
        result = gate(bnpb_files=bnpb_contents(tamper_total=True))

        assert any("national total says" in error for error in result.errors)

    def test_fails_on_low_budget_coverage(self):
        budgets = {("10", "17"): BUDGETS[("10", "17")]}

        result = gate(djpk_contents(budgets))

        assert any("budget coverage" in error for error in result.errors)

    def test_row_count_jump_needs_manual_acceptance(self):
        previous = PreviousVersion(version="old", budget_rows=100, expenditure_rows=1000, disaster_rows=36)

        blocked = gate(previous=previous)
        accepted = gate(previous=previous, accept_row_delta=True)

        assert any("budget_rows changed" in error for error in blocked.errors)
        assert accepted.errors == []
        assert any("accepted after manual review" in warning for warning in accepted.warnings)


class FakeFetcher:
    """Serves fixture files by URL; records which URLs were actually requested."""

    def __init__(self, contents: dict[str, bytes]) -> None:
        from jaga_etl.facts.djpk import source as djpk

        self.by_url: dict[str, bytes] = {}
        for year in YEARS:
            self.by_url[djpk.provinces_url(year)] = (
                contents[djpk.provinces_file(year)] + b"</html>"
            )
            for name, content in contents.items():
                parts = name.removesuffix(".json").removesuffix(".xml").split("-")
                if name.startswith(f"pemda-{year}-"):
                    self.by_url[djpk.pemda_url(parts[2], year)] = content
                elif name.startswith(f"apbd-{year}-"):
                    self.by_url[djpk.apbd_url(year, parts[2], parts[3])] = content
                elif name.startswith(f"tkdd-{year}-"):
                    self.by_url[djpk.tkdd_url(year, parts[2], parts[3])] = content
        self.requested: list[str] = []

    def get(self, url: str) -> bytes:
        self.requested.append(url)
        return self.by_url[url]


class TestFetch:
    def test_concurrent_crawl_produces_a_complete_sealed_snapshot(self, tmp_path: Path):
        from jaga_etl.facts.fetch import fetch_djpk

        fetcher = FakeFetcher(djpk_contents())
        directory, manifest = fetch_djpk(tmp_path, YEARS, fetcher, progress=lambda _: None, workers=4)

        _, contents = read_snapshot(directory)
        assert len(manifest.files) == len(fetcher.by_url)
        assert normalize_djpk(contents, YEARS).rejections == []

    def test_resume_adopts_complete_files_and_refetches_the_rest(self, tmp_path: Path):
        from jaga_etl.facts.djpk import source as djpk
        from jaga_etl.facts.fetch import fetch_djpk

        fetcher = FakeFetcher(djpk_contents())
        interrupted = tmp_path / "djpk" / "run1"
        interrupted.mkdir(parents=True)
        done = djpk.apbd_file(2024, "10", "17")
        (interrupted / done).write_bytes(fetcher.by_url[djpk.apbd_url(2024, "10", "17")])
        (interrupted / djpk.apbd_file(2024, "10", "01")).write_bytes(b"<?xml truncated")
        (interrupted / "apbd-2025-01-15.xml.partial").write_bytes(b"half")

        directory, manifest = fetch_djpk(
            tmp_path, YEARS, fetcher, progress=lambda _: None, resume_snapshot="run1"
        )

        assert djpk.apbd_url(2024, "10", "17") not in fetcher.requested
        assert djpk.apbd_url(2024, "10", "01") in fetcher.requested
        assert len(manifest.files) == len(fetcher.by_url)
        read_snapshot(directory)


def test_bnpb_accepts_whole_numbers_sent_as_decimal_text():
    files = bnpb_contents()
    name = next(iter(files))
    files[name] = files[name].replace(b'"TSUNAMI": 0', b'"TSUNAMI": "0.0"', 1)

    result = normalize_bnpb(files)

    assert result.rejections == []


def test_only_exactly_reviewed_national_total_gaps_are_tolerated():
    from jaga_etl.facts.validate import AcceptedDiscrepancy

    files = bnpb_contents(tamper_total=True)
    tampered = normalize_bnpb(files)
    year, metric, disaster_type = 2024, "event_count", "banjir"
    total = sum(r.event_count or 0 for r in tampered.records if (r.year, r.disaster_type) == (year, disaster_type))
    reported = tampered.national_totals[(year, metric, disaster_type)]
    exact = AcceptedDiscrepancy(year, metric, disaster_type, total, reported)
    stale = AcceptedDiscrepancy(year, metric, disaster_type, total, reported + 5)

    def run(accepted):
        return run_gate(
            normalize_djpk(djpk_contents(), YEARS), tampered, matcher(), REGIONS, PROVINCE_CODES, YEARS, None,
            accepted_discrepancies=accepted,
        )

    remaining = [e for e in run({exact}).errors if "national total" in e]
    assert all("2024 event_count banjir" not in e for e in remaining)
    assert any("2024 event_count banjir" in e for e in run({stale}).errors)
