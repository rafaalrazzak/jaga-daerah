import json
import zipfile
from decimal import Decimal
from pathlib import Path

import pytest

from jaga_etl.fungsi.build import build_payload
from jaga_etl.fungsi.parse import FunctionParseError, parse_workbook

FIXTURES = Path(__file__).parent / "fixtures" / "fungsi"
REPO = Path(__file__).resolve().parents[3]
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def _sheet(rows: list[list[str]]) -> str:
    body = []
    for index, values in enumerate(rows, start=1):
        cells = []
        for column, value in enumerate(values):
            letter = chr(ord("A") + column)
            if column == 4 and index > 1 and value != "":
                cells.append(f'<c r="{letter}{index}"><v>{value}</v></c>')
            else:
                cells.append(
                    f'<c r="{letter}{index}" t="inlineStr"><is><t>{value}</t></is></c>'
                )
        body.append(f'<row r="{index}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<worksheet xmlns="{NS}"><sheetData>{"".join(body)}</sheetData></worksheet>'
    )


def _workbook(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/worksheets/sheet2.xml", _sheet(rows))


def test_tagging_rows_fold_into_the_parent_function_and_provinces_are_skipped(tmp_path: Path):
    workbook = tmp_path / "fungsi.xlsx"
    _workbook(
        workbook,
        [
            ["AkunAnalisismap", "StandarfungsiAdj", "kodepemda", "namapemda", "nilai"],
            ["51. Belanja Pegawai", "10. Pendidikan", "01.08", "Kab. Aceh Utara", "10"],
            ["52. Belanja Barang dan Jasa", "10. Pendidikan Tagging", "01.08", "Kab. Aceh Utara", "15.5"],
            ["51. Belanja Pegawai", "01. Pelayanan Umum", "01.00", "Provinsi Aceh", "999"],
            ["51. Belanja Pegawai", "07. Kesehatan Tagging", "01.08", "Kab. Aceh Utara", "0"],
        ],
    )

    parsed = parse_workbook(workbook)

    by_function = {item.function: item.realization for item in parsed.functions}
    assert by_function == {
        "pendidikan": Decimal("25.50"),
        "kesehatan": Decimal("0.00"),
    }
    assert parsed.province_names == {"01": "Provinsi Aceh"}


def test_unknown_function_label_blocks(tmp_path: Path):
    workbook = tmp_path / "fungsi.xlsx"
    _workbook(
        workbook,
        [
            ["AkunAnalisismap", "StandarfungsiAdj", "kodepemda", "namapemda", "nilai"],
            ["51. Belanja Pegawai", "99. Bukan Fungsi", "01.08", "Kab. Aceh Utara", "1"],
        ],
    )
    with pytest.raises(FunctionParseError, match="99. Bukan Fungsi"):
        parse_workbook(workbook)


def test_unmatched_pemda_name_is_reported_and_not_written(tmp_path: Path):
    workbook = tmp_path / "fungsi.xlsx"
    _workbook(
        workbook,
        [
            ["AkunAnalisismap", "StandarfungsiAdj", "kodepemda", "namapemda", "nilai"],
            ["51. Belanja Pegawai", "04. Ekonomi", "01.08", "Kab. Tidak Ada", "4"],
        ],
    )
    regions = tmp_path / "regions.json"
    regions.write_text(
        json.dumps(
            [
                {
                    "code": "11.08",
                    "name": "Kabupaten Aceh Utara",
                    "province": {"code": "11", "name": "Aceh"},
                }
            ]
        ),
        encoding="utf-8",
    )
    aliases = tmp_path / "aliases.csv"
    aliases.write_text(
        "kind,djpk_province_code,djpk_name,kemendagri_code,note\n",
        encoding="utf-8",
    )
    parsed = parse_workbook(workbook)
    payload, result = build_payload(
        parsed,
        regions,
        aliases,
        sha256="a" * 64,
        downloaded_at="2026-10-18T00:00:00+00:00",
    )
    assert payload == {}
    assert result.unmatched == ["01.08 Kab. Tidak Ada (provinsi tidak dikenal)"]


def test_published_bandung_education_includes_the_tagging_line():
    artifact = REPO / "apps" / "web" / "src" / "data" / "expenditure-functions.json"
    if not artifact.exists():
        pytest.skip("artifact is produced by jaga_etl.fungsi build")
    payload = json.loads(artifact.read_text(encoding="utf-8"))
    rows = {row["type"]: row["realization_amount"] for row in payload["regions"]["32.73"]}
    # 1.012.175.345 (Pendidikan) + 1.849.459.085.698 (Pendidikan Tagging).
    assert rows["pendidikan"] == "1850471261043.00"
    assert payload["source"]["url"].endswith("31102025_Realisasi_Belanja_Daerah_2024.xlsx")
