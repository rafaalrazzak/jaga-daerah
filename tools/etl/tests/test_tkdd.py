from decimal import Decimal

import pytest

from facts_fixtures import YEARS, djpk_contents, tkdd_spreadsheet
from jaga_etl.facts.djpk.normalize import normalize, parse_rows
from jaga_etl.facts.djpk.tkdd import classify, parse_miliar, resource_amounts


class TestParseMiliar:
    def test_converts_indonesian_miliar_text_to_exact_rupiah(self):
        assert parse_miliar("4.580,69 M") == Decimal("4580690000000.00")
        assert parse_miliar("0,32 M") == Decimal("320000000.00")
        assert parse_miliar("0,00 M") == Decimal("0.00")

    def test_blank_stays_unknown(self):
        assert parse_miliar("  ") is None

    @pytest.mark.parametrize("text", ["4580.69 M", "4.580,69", "4,580.69 M", "-1,00 M", "1,0 M", "12 jt"])
    def test_rejects_any_other_shape(self, text: str):
        with pytest.raises(ValueError):
            parse_miliar(text)


class TestClassify:
    @pytest.mark.parametrize(
        ("account", "expected"),
        [
            ("DBH SDA Minyak Bumi 15%", "minyak_bumi"),
            ("DBH SDA Gas Bumi 30%", "gas_bumi"),
            ("DBH SDA Minerba - Royalti", "minerba"),
            ("DBH SDA Kehutanan - Dana Reboisasi", "kehutanan"),
            ("DBH SDA Perikanan", "perikanan"),
            ("DBH SDA Pengusahaan Panas Bumi - Iuran Tetap", "panas_bumi"),
            ("Dana Bagi Hasil Perkebunan Sawit", "perkebunan_sawit"),
            ("DBH PPh Pasal 21", None),
            ("Dana Alokasi Umum", None),
        ],
    )
    def test_groups_known_lines(self, account: str, expected: str | None):
        assert classify(account) == expected

    def test_unknown_resource_lines_block_for_review(self):
        with pytest.raises(ValueError, match="unrecognised resource line"):
            classify("DBH SDA Air Permukaan")


class TestResourceAmounts:
    def test_sums_lines_per_resource(self):
        rows = parse_rows(
            tkdd_spreadsheet(
                [
                    ("DBH SDA Panas Bumi - Iuran Tetap", "1.200,00 M", "1.150,40 M"),
                    ("DBH SDA Panas Bumi - Setoran Bagian Pemerintah", "0,10 M", "0,10 M"),
                ]
            )
        )

        [amount] = resource_amounts(rows)

        assert amount.resource_type == "panas_bumi"
        assert amount.budget_amount == Decimal("1200100000000.00")
        assert amount.realization_amount == Decimal("1150500000000.00")
        assert amount.lines == 2

    def test_a_blank_line_makes_the_group_unknown(self):
        rows = parse_rows(
            tkdd_spreadsheet(
                [
                    ("DBH SDA Minerba - Royalti", "5,00 M", ""),
                    ("DBH SDA Minerba - Iuran Tetap", "1,00 M", "1,00 M"),
                ]
            )
        )

        [amount] = resource_amounts(rows)

        assert amount.budget_amount == Decimal("6000000000.00")
        assert amount.realization_amount is None

    def test_duplicate_lines_are_rejected_rather_than_double_counted(self):
        rows = parse_rows(
            tkdd_spreadsheet([("DBH SDA Perikanan", "1,00 M", "1,00 M"), ("DBH SDA Perikanan", "1,00 M", "1,00 M")])
        )

        with pytest.raises(ValueError, match="duplicate"):
            resource_amounts(rows)


class TestNormalizeTkdd:
    def test_reads_resources_alongside_budgets(self):
        result = normalize(djpk_contents(), YEARS)

        assert result.rejections == []
        assert result.tkdd_files_read == 6
        bandung = {r.resource_type: r for r in result.resources if r.djpk_pemda_name == "Kota Bandung"}
        assert sorted(bandung) == ["gas_bumi", "minyak_bumi", "panas_bumi"]
        assert bandung["gas_bumi"].realization_amount == Decimal("3000000000.00")
        assert all(r.year == 2025 for r in result.resources)

    def test_missing_tkdd_file_blocks(self):
        contents = djpk_contents()
        del contents["tkdd-2025-10-17.xml"]

        result = normalize(contents, YEARS)

        assert result.rejections == ["missing snapshot file tkdd-2025-10-17.xml"]
