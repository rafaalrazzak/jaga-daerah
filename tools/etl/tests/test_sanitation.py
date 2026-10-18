import json

import pytest

from jaga_etl.sanitation.build import _assign
from jaga_etl.sanitation.parse import SanitationError, extract_table

NOTE = (
    "<p><b>Definisi:</b> rumah tangga dengan kloset leher angsa dan tangki septik. "
    "<b>Sumber Data:</b> Susenas KOR</p>"
)


def _table(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "status": "OK",
        "data-availability": "available",
        "last_update": "2026-08-29 05:30:09",
        "labelvervar": "Kabupaten/Kota",
        "var": [
            {
                "val": 2748,
                "unit": "Persen",
                "decimal": 2,
                "note": NOTE,
            }
        ],
        "turvar": [{"val": 0, "label": "Tidak ada"}],
        "tahun": [{"val": 125, "label": "2025"}, {"val": 124, "label": "2024"}],
        "turtahun": [{"val": 0, "label": "Tahun"}],
        "vervar": [
            {"val": 1101, "label": "Simeulue"},
            {"val": 3273, "label": "Kota Bandung"},
            {"val": 7605, "label": "Mamuju Utara"},
            {"val": 9501, "label": "Merauke"},
        ],
        "datacontent": {
            "1101274801250": 78.94,
            "3273274801250": 56.5,
            "7605274801250": 84.15,
            "9501274801250": 88.37,
        },
    }
    payload.update(overrides)
    return payload


def _page(payload: dict[str, object]) -> str:
    chunk = '7:{"data":' + json.dumps(payload) + "}"
    return "<script>self.__next_f.push([1," + json.dumps(chunk) + "])</script>"


REGIONS = [
    {"code": "11.09", "name": "Kabupaten Simeulue"},
    {"code": "32.73", "name": "Kota Bandung"},
    {"code": "76.01", "name": "Kabupaten Pasangkayu"},
    {"code": "93.01", "name": "Kabupaten Merauke"},
    {"code": "95.01", "name": "Kabupaten Jayawijaya"},
]


def test_page_keeps_two_decimals_and_does_not_trust_bps_codes():
    table = extract_table(_page(_table()))
    assigned = _assign(table, REGIONS[:4])
    assert assigned == {
        "11.09": "78.94",
        "32.73": "56.50",
        "76.01": "84.15",
        "93.01": "88.37",
    }
    assert table.last_update == "2026-08-29 05:30:09"


def test_old_papua_code_stays_on_merauke_and_does_not_fill_jayawijaya():
    payload = _table()
    payload["vervar"] = [{"val": 9501, "label": "Merauke"}]
    payload["datacontent"] = {"9501274801250": 88.37}
    table = extract_table(_page(payload))
    assert _assign(table, [REGIONS[3]]) == {"93.01": "88.37"}
    with pytest.raises(SanitationError, match="95.01"):
        _assign(table, [REGIONS[3], REGIONS[4]])


def test_a_blank_cell_stays_empty():
    payload = _table()
    vervar = payload["vervar"]
    assert isinstance(vervar, list)
    vervar.append({"val": 9607, "label": "Puncak"})
    table = extract_table(_page(payload))
    assigned = _assign(table, [*REGIONS[:4], {"code": "94.05", "name": "Kabupaten Puncak"}])
    assert assigned["94.05"] is None
    assert all(value != "0.00" for value in assigned.values())


def test_a_missing_cell_stays_empty_and_still_covers_the_region():
    payload = _table()
    payload["vervar"] = [{"val": 9607, "label": "Puncak"}]
    payload["datacontent"] = {}
    table = extract_table(_page(payload))
    assert table.rows[0].percent is None
    assert _assign(table, [{"code": "94.05", "name": "Kabupaten Puncak"}]) == {"94.05": None}


def test_unmatched_bps_name_blocks_the_build():
    table = extract_table(_page(_table()))
    with pytest.raises(SanitationError, match="Mamuju Utara"):
        _assign(table, REGIONS[:2])


def test_extra_precision_and_a_changed_definition_are_rejected():
    precise = _table()
    cells = precise["datacontent"]
    assert isinstance(cells, dict)
    cells["1101274801250"] = "78.941"
    with pytest.raises(SanitationError, match="two decimals"):
        extract_table(_page(precise))

    redefined = _table()
    var = redefined["var"]
    assert isinstance(var, list)
    var[0]["note"] = "akses air minum"
    with pytest.raises(SanitationError, match="Susenas KOR"):
        extract_table(_page(redefined))
