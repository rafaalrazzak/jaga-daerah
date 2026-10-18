import json
from pathlib import Path

import pytest

from jaga_etl.opinions.build import build_payload
from jaga_etl.opinions.parse import OpinionParseError, parse_opinions

HEADER = "Provinsi,No,Kode Provinsi,Kode Kab/Kota,Entitas,2016,2017,2018,2019,2020,2021,2022,2023,2024"


def _row(province: str, region: str, entity: str, opinions: list[str]) -> str:
    cells = [f"Provinsi {province}", "1", province, region, entity, *opinions]
    return ",".join(cells)


def _file(rows: list[str]) -> str:
    return "\n".join([HEADER, *rows])


def _provinces() -> list[str]:
    codes = [
        "11", "12", "13", "14", "15", "16", "17", "18", "19", "21",
        "31", "32", "33", "34", "35", "36", "51", "52", "53",
        "61", "62", "63", "64", "65", "71", "72", "73", "74", "75", "76",
        "81", "82", "91", "92", "93", "94", "95", "96",
    ]
    assert len(codes) == 38
    return codes


def _national(extra: list[str] | None = None) -> str:
    rows = [_row(code, "", f"Pemerintah {code}", ["WTP"] * 9) for code in _provinces()]
    for code in _provinces():
        if code in {"31", "32", "94"}:
            continue
        rows.append(_row(code, f"{code}.01", f"Pemerintah {code}.01", ["WTP"] * 9))
    rows.append(
        _row(
            "32",
            "32.73",
            "Pemerintah Kota Bandung",
            ["WDP", "WDP", "WTP", "WTP", "WTP", "WTP", "WTP", "WTP", "WTP"],
        )
    )
    rows.append(
        _row("94", "94.08", "Pemerintah Kabupaten Deiyai", ["", "", "", "", "", "", "WDP", "WTP", "WTP"])
    )
    if extra:
        rows.extend(extra)
    return _file(rows)


def _reference(extra: list[dict[str, object]] | None = None) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for code in _provinces():
        region_code = "31.71" if code == "31" else "32.73" if code == "32" else "94.08" if code == "94" else f"{code}.01"
        rows.append({"code": region_code, "province": {"code": code}})
    if extra:
        rows.extend(extra)
    return rows


def test_blank_early_years_stay_blank_and_2024_is_required():
    regions, provinces = parse_opinions(_national())
    assert provinces["31"].years[-1] == (2024, "WTP")
    assert regions["94.08"].years == ((2022, "WDP"), (2023, "WTP"), (2024, "WTP"))
    assert "31.71" not in regions


def test_an_unknown_opinion_is_rejected():
    broken = _national([_row("32", "32.04", "Kabupaten Bandung", ["WTP"] * 8 + ["BAIK"])])
    with pytest.raises(OpinionParseError, match="tidak dikenal"):
        parse_opinions(broken)


def test_build_keeps_dki_administrative_regions_on_the_province_opinion(tmp_path: Path):
    regions_path = tmp_path / "regions.json"
    regions_path.write_text(json.dumps(_reference()), encoding="utf-8")
    payload, result = build_payload(
        _national(),
        regions_path,
        sha256="a" * 64,
        retrieved_at="2026-10-18T06:20:00+00:00",
    )
    assert result.regions == 37
    assert "31.71" not in payload["regions"]
    assert payload["provinces"]["31"]["years"][-1]["opinion"] == "WTP"


def test_a_missing_autonomous_region_blocks_the_build(tmp_path: Path):
    regions_path = tmp_path / "regions.json"
    regions_path.write_text(
        json.dumps(_reference([{"code": "32.04", "province": {"code": "32"}}])),
        encoding="utf-8",
    )
    with pytest.raises(OpinionParseError, match="kecocokan"):
        build_payload(_national(), regions_path, sha256="a" * 64, retrieved_at="2026-10-18T06:20:00+00:00")
