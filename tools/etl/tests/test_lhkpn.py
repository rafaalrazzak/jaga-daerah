"""LHKPN captures → published figures, offline.

Every capture here is a synthetic file under `tests/fixtures/lhkpn/`: no real person's declaration is
committed (see `data/captures/README.md`). The behaviour under test is the gate — what may be
published and what must stop the build — plus year and position selection, which is where the source's
own structure (one person, several institutions and offices) can mislead a naive implementation.
"""

import csv
import hashlib
import json
from pathlib import Path

import pytest

from jaga_etl.lhkpn.build import (
    Capture,
    build,
    read_institutions,
    read_regions,
    register,
    suggested_lembaga,
    worklist_rows,
    write_provenance,
    write_worklist,
)
from jaga_etl.lhkpn.parse import CaptureError, parse_amount, parse_capture

FIXTURES = Path(__file__).parent / "fixtures" / "lhkpn"
REFERENCE = Path(__file__).parents[1] / "reference" / "lhkpn-institutions.csv"
BOGOR = "32.01.html"
BANDUNG = "32.73.html"

REGIONS = [
    {"code": "32.01", "name": "Kabupaten Bogor", "type": "kabupaten"},
    {"code": "32.73", "name": "Kota Bandung", "type": "kota"},
]
OFFICIALS = {
    "regions": {
        "32.01": {"head": {"name": "Budi Santoso"}, "deputy": None},
        "32.73": {"head": {"name": "Ahmad Faizal"}, "deputy": None},
    }
}
REVIEWED = ["PEMERINTAH KABUPATEN BOGOR,32.01,reviewed", "PEMERINTAH KOTA BANDUNG,32.73,reviewed"]


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def write_reference(tmp_path: Path, rows: list[str]) -> Path:
    path = tmp_path / "lhkpn-institutions.csv"
    path.write_text("lembaga,region_code,note\n" + "\n".join(rows) + "\n", encoding="utf-8", newline="\n")
    return path


def write_inputs(tmp_path: Path) -> tuple[Path, Path]:
    regions = tmp_path / "regions.json"
    officials = tmp_path / "officials.json"
    regions.write_text(json.dumps(REGIONS), encoding="utf-8", newline="\n")
    officials.write_text(json.dumps(OFFICIALS), encoding="utf-8", newline="\n")
    return regions, officials


def capture_dir(tmp_path: Path, files: dict[str, bytes], *, limit: int = 10) -> Path:
    """A capture directory as a human leaves it: saved pages plus the worklist that asked for them."""
    directory = tmp_path / "captures"
    regions_file, officials_file = write_inputs(tmp_path)
    write_worklist(worklist_rows(limit=limit, regions=read_regions(regions_file, officials_file)), directory)
    for name, content in files.items():
        (directory / name).write_bytes(content)
    return directory


def offline_build(directory: Path, tmp_path: Path, institutions: list[str] | None = None):
    regions_file, officials_file = tmp_path / "regions.json", tmp_path / "officials.json"
    return build(
        captures_dir=directory,
        institutions_file=write_reference(tmp_path, institutions or REVIEWED),
        officials_file=officials_file,
        regions_file=regions_file,
    )


def registered(tmp_path: Path, files: dict[str, bytes], *, institutions: list[str] | None = None):
    """Register `files`, then run the full offline build over them."""
    directory = capture_dir(tmp_path, files)
    captures, errors = register(directory)
    assert errors == []
    write_provenance(captures, directory / "provenance.csv")
    return offline_build(directory, tmp_path, institutions)


class TestParse:
    def test_extracts_every_row_with_its_own_year_position_and_id(self):
        rows = parse_capture(fixture("announcement-bogor.html"), "announcement-bogor.html")

        assert [(row.name, row.year, row.position) for row in rows] == [
            ("BUDI SANTOSO", 2025, "BUPATI"),
            ("BUDI SANTOSO", 2024, "BUPATI"),
            ("SITI RAHAYU", 2025, "WAKIL BUPATI"),
        ]
        assert rows[0].announcement_id == "9f3c1a20"
        assert rows[0].report_code == "R"
        assert rows[0].lembaga == "PEMERINTAH KABUPATEN BOGOR"

    def test_reads_the_hidden_cells_not_the_display_text(self):
        # The hidden `tgl_lapor` year and `lhkpn` id are what a row is identified by, so a visible
        # column that is absent, reordered, or written differently cannot change year or identity.
        rows = parse_capture(
            b'<table><tr><th>Nama</th><th>Lembaga</th><th>Jabatan</th><th>Total Harta Kekayaan</th></tr>'
            b'<tr><td>X</td><td>PEMERINTAH KOTA BANDUNG</td><td>WALI KOTA</td><td>Rp.1.000</td>'
            b'<td class="lhkpn" hidden>deadbeef</td><td class="tgl_lapor" hidden>2021</td></tr></table>',
            "inline.html",
        )

        assert (rows[0].year, rows[0].announcement_id, rows[0].amount) == (2021, "deadbeef", "Rp.1.000")

    def test_a_json_capture_holding_the_same_response_is_read_the_same_way(self):
        payload = json.dumps({"status": True, "data": fixture("announcement-bogor.html").decode()}).encode()

        rows = parse_capture(payload, "32.01.json")

        assert [row.year for row in rows] == [2025, 2024, 2025]

    def test_a_page_without_a_results_table_blocks(self):
        with pytest.raises(CaptureError, match="no results table"):
            parse_capture(b"<html><body><p>Tidak ada data</p></body></html>", "empty.html")

    def test_an_empty_or_unreadable_capture_blocks(self):
        with pytest.raises(CaptureError, match="empty"):
            parse_capture(b"   ", "blank.html")
        with pytest.raises(CaptureError, match="not a readable JSON capture"):
            parse_capture(b"{oops", "broken.json")

    def test_a_table_without_data_rows_blocks(self):
        header = (
            b"<table><tr><th>Nama</th><th>Lembaga</th><th>Jabatan</th>"
            b"<th>Total Harta Kekayaan</th></tr></table>"
        )

        with pytest.raises(CaptureError, match="no data rows"):
            parse_capture(header, "header-only.html")

    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            (" Rp.12.641.245.449", "12641245449.00"),
            ("Rp 823.500.000", "823500000.00"),
            ("1234", "1234.00"),
            ("Rp.1.234,50", "1234.50"),
        ],
    )
    def test_thousand_separators_become_exact_decimal_strings(self, text: str, expected: str):
        assert parse_amount(text) == expected

    @pytest.mark.parametrize(
        "text",
        ["", " ", "Rp.-", "tidak tersedia", "Rp.0", "0", "Rp.1.234.567.890.123.456.789"],
    )
    def test_rejects_anything_that_is_not_a_positive_rupiah_amount(self, text: str):
        with pytest.raises(CaptureError):
            parse_amount(text)


class TestWorklist:
    def test_names_the_region_person_institution_and_save_path(self, tmp_path: Path):
        regions_file, officials_file = write_inputs(tmp_path)

        rows = worklist_rows(limit=10, regions=read_regions(regions_file, officials_file))

        assert rows == [
            {
                "region_code": "32.01",
                "region": "Kabupaten Bogor",
                "official": "Budi Santoso",
                "search_lembaga": "PEMERINTAH KABUPATEN BOGOR",
                "capture_file": BOGOR,
            },
            {
                "region_code": "32.73",
                "region": "Kota Bandung",
                "official": "Ahmad Faizal",
                "search_lembaga": "PEMERINTAH KOTA BANDUNG",
                "capture_file": BANDUNG,
            },
        ]

    def test_the_limit_bounds_a_pilot_and_zero_covers_every_region(self, tmp_path: Path):
        regions = [
            {"code": f"32.{index:02d}", "name": f"Kabupaten Uji {index}", "type": "kabupaten"}
            for index in range(1, 31)
        ]
        officials = {"regions": {r["code"]: {"head": {"name": f"Kepala {r['code']}"}} for r in regions}}
        regions_file, officials_file = tmp_path / "regions.json", tmp_path / "officials.json"
        regions_file.write_text(json.dumps(regions), encoding="utf-8", newline="\n")
        officials_file.write_text(json.dumps(officials), encoding="utf-8", newline="\n")
        index = read_regions(regions_file, officials_file)

        assert len(worklist_rows(limit=10, regions=index)) == 10
        assert len(worklist_rows(limit=0, regions=index)) == 30

    def test_the_written_worklist_states_the_institution_and_the_save_path(self, tmp_path: Path):
        regions_file, officials_file = write_inputs(tmp_path)
        directory = tmp_path / "captures"

        write_worklist(worklist_rows(limit=10, regions=read_regions(regions_file, officials_file)), directory)
        rows = list(csv.DictReader((directory / "worklist.csv").open(encoding="utf-8")))
        markdown = (directory / "README.worklist.md").read_text(encoding="utf-8")

        assert [row["capture_file"] for row in rows] == [BOGOR, BANDUNG]
        assert "PEMERINTAH KABUPATEN BOGOR" in markdown
        assert "reCAPTCHA" in markdown and "sendiri" in markdown

    def test_suggested_institution_follows_kpk_naming(self):
        assert suggested_lembaga("Kabupaten Bogor") == "PEMERINTAH KABUPATEN BOGOR"
        assert suggested_lembaga("Kota Bandung") == "PEMERINTAH KOTA BANDUNG"


class TestBuild:
    def test_publishes_every_year_with_the_position_held_that_year(self, tmp_path: Path):
        payload, errors = registered(tmp_path, {BOGOR: fixture("announcement-office-history.html")})

        assert errors == []
        region = payload["regions"]["32.01"]
        assert region["lembaga"] == "PEMERINTAH KABUPATEN BOGOR"
        assert region["official"] == "Budi Santoso"
        assert [(report["year"], report["position"]) for report in region["reports"]] == [
            (2024, "WAKIL BUPATI"),
            (2025, "BUPATI"),
            (2026, "SEKRETARIS DAERAH"),
        ]
        assert region["latest"]["year"] == 2025
        assert region["latest"]["total_assets"] == "12641245449.00"
        # Every figure keeps a reporting year, a position, a source, and a processing date.
        assert all(report["source"] == "https://elhkpn.kpk.go.id/" for report in region["reports"])
        assert region["processed_at"] and region["downloaded_at"]

    def test_the_figure_is_a_decimal_string_never_a_javascript_number(self, tmp_path: Path):
        payload, _ = registered(tmp_path, {BOGOR: fixture("announcement-bogor.html")})

        assert all(isinstance(report["total_assets"], str) for report in payload["regions"]["32.01"]["reports"])
        assert payload["regions"]["32.01"]["latest"]["total_assets"] == "12641245449.00"

    def test_latest_is_the_newest_report_for_the_office_held_now(self, tmp_path: Path):
        # 2026 is the newest year in the table but it is a "SEKRETARIS DAERAH" row; only a Bupati row
        # may be the headline figure, and the 2024 deputy row must never be one either.
        payload, errors = registered(tmp_path, {BOGOR: fixture("announcement-office-history.html")})

        assert errors == []
        assert payload["regions"]["32.01"]["latest"]["position"] == "BUPATI"

    def test_blocks_when_no_row_carries_the_office_held_now(self, tmp_path: Path):
        page = fixture("announcement-bogor.html").replace(b">BUPATI<", b">SEKRETARIS DAERAH<")

        payload, errors = registered(tmp_path, {BOGOR: page})

        assert payload["regions"] == {}
        assert any("no row states the office held now (BUPATI)" in error for error in errors)

    def test_rows_for_another_person_are_not_published_as_the_heads_figures(self, tmp_path: Path):
        # The fixture also holds a deputy's row; the published record is the head's, so her figure is
        # left out rather than attached to him.
        payload, errors = registered(tmp_path, {BOGOR: fixture("announcement-bogor.html")})

        assert errors == []
        reports = payload["regions"]["32.01"]["reports"]
        assert [(report["year"], report["position"]) for report in reports] == [
            (2024, "BUPATI"),
            (2025, "BUPATI"),
        ]
        assert "823500000.00" not in json.dumps(payload)

    def test_blocks_a_capture_with_no_results_table(self, tmp_path: Path):
        payload, errors = registered(tmp_path, {BOGOR: b"<html><body>kosong</body></html>"})

        assert payload["regions"] == {}
        assert any("no results table" in error for error in errors)

    def test_blocks_an_institution_absent_from_the_reviewed_csv(self, tmp_path: Path):
        # The Bogor row is real, but this build reviews only the Bandung mapping, so the join the
        # capture needs does not exist and nothing may be published from it.
        payload, errors = registered(
            tmp_path,
            {BOGOR: fixture("announcement-bogor.html")},
            institutions=["PEMERINTAH KOTA BANDUNG,32.73,reviewed"],
        )

        assert payload["regions"] == {}
        assert any("PEMERINTAH KABUPATEN BOGOR" in error and "not in" in error for error in errors)

    def test_blocks_a_row_whose_institution_is_not_a_regional_government(self, tmp_path: Path):
        # The KPUD and DPRD rows in this fixture are one person's earlier career, not this region's
        # government; publishing them would attach the wrong office to the region.
        payload, errors = registered(
            tmp_path, {BOGOR: fixture("announcement-mixed-institutions.html")}
        )

        assert payload["regions"] == {}
        assert any("not a regional government" in error for error in errors)

    def test_blocks_a_capture_whose_institution_maps_to_another_region(self, tmp_path: Path):
        page = fixture("announcement-bogor.html").replace(
            b"PEMERINTAH KABUPATEN BOGOR", b"PEMERINTAH KOTA BANDUNG"
        )

        payload, errors = registered(tmp_path, {BOGOR: page})

        assert payload["regions"] == {}
        assert any("maps to ['32.73'], not to region 32.01" in error for error in errors)

    def test_blocks_conflicting_captures_for_one_region(self, tmp_path: Path):
        directory = capture_dir(tmp_path, {BOGOR: fixture("announcement-bogor.html")})
        duplicate = fixture("announcement-bogor.html").replace(b"12.641.245.449", b"99.999.999.999")
        (directory / "32.01-kedua.html").write_bytes(duplicate)
        # A second capture for the same region is only possible if the worklist asks for two searches
        # that resolve to one region, which is what this worklist row models.
        rows = list(csv.DictReader((directory / "worklist.csv").open(encoding="utf-8")))
        with (directory / "worklist.csv").open("w", encoding="utf-8", newline="\n") as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerow(rows[0])
            writer.writerow({**rows[0], "capture_file": "32.01-kedua.html"})
        captures, errors = register(directory)
        assert errors == []
        write_provenance(captures, directory / "provenance.csv")

        payload, gate_errors = offline_build(directory, tmp_path)

        assert payload["regions"] == {}
        assert any("conflicting figures" in error for error in gate_errors)

    def test_blocks_a_capture_whose_bytes_changed_after_registration(self, tmp_path: Path):
        directory = capture_dir(tmp_path, {BOGOR: fixture("announcement-bogor.html")})
        captures, _ = register(directory)
        write_provenance(captures, directory / "provenance.csv")
        (directory / BOGOR).write_bytes(
            fixture("announcement-bogor.html").replace(b"12.641.245.449", b"12.641.245.450")
        )

        payload, errors = offline_build(directory, tmp_path)

        assert payload["regions"] == {}
        assert any("provenance records" in error for error in errors)

    def test_blocks_a_capture_without_a_provenance_record(self, tmp_path: Path):
        directory = capture_dir(tmp_path, {})
        (directory / BOGOR).write_bytes(fixture("announcement-bogor.html"))

        payload, errors = offline_build(directory, tmp_path)

        assert payload["regions"] == {}
        assert any("no provenance record" in error for error in errors)

    def test_blocks_a_capture_registered_for_a_region_no_worklist_row_asks_for(self, tmp_path: Path):
        # Provenance is hand-editable, so a stale or invented registration must not survive the gate.
        directory = capture_dir(tmp_path, {})
        (directory / BOGOR).write_bytes(fixture("announcement-bogor.html"))
        write_provenance(
            [Capture(BOGOR, "11.01", hashlib.sha256(fixture("announcement-bogor.html")).hexdigest(), "now")],
            directory / "provenance.csv",
        )

        payload, errors = offline_build(directory, tmp_path)

        assert payload["regions"] == {}
        assert any("which no worklist row asks for" in error for error in errors)

    def test_blocks_an_amount_that_is_not_a_positive_rupiah_figure(self, tmp_path: Path):
        # Zero is a reported value, but not one this section may show, and unparseable text is no
        # figure at all: both must block rather than publish a number the source did not state.
        for broken in ("Rp.0", "tidak tersedia"):
            page = fixture("announcement-bogor.html").replace(
                b"Rp.12.641.245.449", broken.encode()
            )

            payload, errors = registered(tmp_path, {BOGOR: page})

            assert payload["regions"] == {}
            assert any("rupiah amount" in error for error in errors)

    def test_blocks_a_row_missing_the_labels_the_figure_requires(self, tmp_path: Path):
        # The hidden year cell carries the reporting year; without it the row cannot show the year a
        # figure belongs to, so it must not be published.
        page = fixture("announcement-office-history.html").replace(
            b'<td class="tgl_lapor" hidden>2026</td>', b'<td class="tgl_lapor" hidden></td>'
        ).replace(b"31 Desember 2026", b"-")

        payload, errors = registered(tmp_path, {BOGOR: page})

        assert payload["regions"] == {}
        assert any("missing year" in error for error in errors)

    def test_no_captures_publishes_an_empty_artifact(self, tmp_path: Path):
        # The repository's default state: no capture exists yet, so nothing is published, the build
        # still succeeds, and the UI renders "belum tersedia" for every region.
        directory = capture_dir(tmp_path, {})

        payload, errors = build(
            captures_dir=directory,
            institutions_file=REFERENCE,
            officials_file=tmp_path / "officials.json",
            regions_file=tmp_path / "regions.json",
        )

        assert errors == []
        assert payload["regions"] == {}
        assert payload["source"]["url"] == "https://elhkpn.kpk.go.id/"
        assert payload["source"]["publisher"] == "Komisi Pemberantasan Korupsi (KPK)"

    def test_two_regions_publish_side_by_side(self, tmp_path: Path):
        bandung = (
            fixture("announcement-office-history.html")
            .replace(b"PEMERINTAH KABUPATEN BOGOR", b"PEMERINTAH KOTA BANDUNG")
            .replace(b"BUDI SANTOSO", b"AHMAD FAIZAL")
            .replace(b">BUPATI<", b">WALI KOTA<")
            .replace(b">WAKIL BUPATI<", b">WAKIL WALI KOTA<")
        )
        payload, errors = registered(
            tmp_path, {BOGOR: fixture("announcement-office-history.html"), BANDUNG: bandung}
        )

        assert errors == []
        assert sorted(payload["regions"]) == ["32.01", "32.73"]
        assert payload["regions"]["32.73"]["latest"]["position"] == "WALI KOTA"

    def test_extraction_keeps_no_identifier_beyond_name_and_position(self, tmp_path: Path):
        rows = parse_capture(fixture("announcement-bogor.html"), "announcement-bogor.html")
        payload, _ = registered(tmp_path, {BOGOR: fixture("announcement-bogor.html")})

        serialized = json.dumps(payload, ensure_ascii=False)
        assert "20251231000001" not in serialized  # the fixture's `lhkpnori` filing reference
        assert "nik" not in serialized.casefold()
        assert {field for row in rows for field in vars(row)} == {
            "announcement_id",
            "name",
            "lembaga",
            "unit_kerja",
            "position",
            "reported_on",
            "report_code",
            "report_type",
            "amount",
            "year",
        }

    def test_every_published_region_carries_the_net_total_caveat(self, tmp_path: Path):
        payload, _ = registered(tmp_path, {BOGOR: fixture("announcement-bogor.html")})

        notes = payload["regions"]["32.01"]["notes"]
        assert "aset dikurangi utang" in notes
        assert "bukan hasil audit" in notes


class TestProvenance:
    def test_records_the_hash_of_the_exact_bytes_saved(self, tmp_path: Path):
        content = fixture("announcement-bogor.html")
        directory = capture_dir(tmp_path, {BOGOR: content})

        captures, errors = register(directory)

        assert errors == []
        assert captures == [
            Capture(BOGOR, "32.01", hashlib.sha256(content).hexdigest(), captures[0].registered_at)
        ]

    def test_refuses_a_capture_no_worklist_row_asks_for(self, tmp_path: Path):
        directory = capture_dir(tmp_path, {"99.99.html": fixture("announcement-bogor.html")})

        captures, errors = register(directory)

        assert captures == []
        assert any("no worklist row asks for" in error for error in errors)

    def test_refuses_to_register_without_a_worklist(self, tmp_path: Path):
        directory = tmp_path / "captures"
        directory.mkdir()

        captures, errors = register(directory)

        assert captures == []
        assert any("no worklist" in error for error in errors)

    def test_refuses_to_register_when_no_capture_exists_yet(self, tmp_path: Path):
        directory = capture_dir(tmp_path, {})

        captures, errors = register(directory)

        assert captures == []
        assert any("nothing to register" in error for error in errors)

    def test_the_reviewed_reference_file_reads_as_an_institution_map(self):
        assert read_institutions(REFERENCE)["pemerintahkabupatenbogor"] == "32.01"
