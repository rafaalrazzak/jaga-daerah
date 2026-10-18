from jaga_etl.population.parse import PopulationError, parse_rows, require_regions

import pytest

SQL = """
INSERT INTO wilayah_penduduk(kode, nama, pria, wanita, total)
VALUES
('0','INDONESIA','6','6','12'),
('11','Aceh','3','2','5'),
('11.01','Kabupaten Aceh Selatan','2','1','3'),
('11.71','Kota Banda Aceh','1','1','2'),
('12','Sumatera Utara','3','4','7'),
('12.11','Kabupaten Dairi','3','4','7');
"""

# The release gate checks a fixed national total, so the fixture uses the parser pieces directly
# and a stand-in total is injected by rewriting the national row in the tests that need the gate.


def test_parse_reads_codes_and_sex_totals():
    rows = parse_rows(SQL)
    assert rows[1].code == "11"
    assert rows[2].total == 3
    assert rows[2].male + rows[2].female == rows[2].total


def test_rejects_a_different_place_name_but_allows_a_doubled_space(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("jaga_etl.population.parse.NATIONAL_TOTAL", 12)
    monkeypatch.setattr("jaga_etl.population.parse.SPOT_CHECKS", {})
    regions = [
        {"code": "11.01", "name": "Kabupaten Aceh Selatan"},
        {"code": "11.71", "name": "Kota Banda Aceh"},
        {"code": "12.11", "name": "Kabupaten Dairi"},
    ]
    spaced = SQL.replace("Kabupaten Aceh Selatan", "Kabupaten  Aceh Selatan")
    checked = require_regions(parse_rows(spaced), regions)
    assert checked["11.01"].total == 3

    renamed = SQL.replace("Kabupaten Aceh Selatan", "Kabupaten Aceh Utara")
    with pytest.raises(PopulationError, match="names differ"):
        require_regions(parse_rows(renamed), regions)


def test_rejects_a_row_whose_sex_counts_do_not_add_up():
    broken = SQL.replace(
        "('11.01','Kabupaten Aceh Selatan','2','1','3')",
        "('11.01','Kabupaten Aceh Selatan','2','1','9')",
    )
    with pytest.raises(PopulationError, match="male\\+female"):
        require_regions(
            parse_rows(broken),
            [
                {"code": "11.01", "name": "Kabupaten Aceh Selatan"},
                {"code": "11.71", "name": "Kota Banda Aceh"},
                {"code": "12.11", "name": "Kabupaten Dairi"},
            ],
        )
