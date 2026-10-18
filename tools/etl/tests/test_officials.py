import pytest

from jaga_etl.incumbents.__main__ import _apply_overrides, _kpu_match, _read_overrides
from jaga_etl.incumbents.mapping import candidate_names, match_region, party_name, same_person, similarity
from jaga_etl.incumbents.wikitext import parse_row, table_rows
from jaga_etl.officials.parse import parse_candidates


def card(number: str | None, head: str, deputy: str, head_id: int, deputy_id: int, parties: list[str]) -> str:
    numbered = f'<p><i>NOMOR URUT</i></p><h1 class="x"><strong>{number}</strong></h1>' if number else "<p><i>NOMOR URUT</i></p><h1></h1>"
    logos = "".join(f'<img src="x" alt="{party}" class="img-fluid">' for party in parties)
    return (
        f'<div class="col-md-4 mb-4"><div class="card">{numbered}'
        f'<p><strong>CALON</strong></p><img src="photo"><p class="text-center"><strong>{head}</strong></p>'
        f'<button data-target="#modalCakada{head_id}">Profil</button>'
        f'<p><strong>WAKIL CALON</strong></p><p class="text-center"><strong>{deputy}</strong></p>'
        f'<button data-target="#modalCawakeda{deputy_id}">Profil</button>'
        f'<h6>Partai Politik</h6><div class="d-flex">{logos}</div>'
        '<h6 class="mb-1 text-secondary">Visi</h6><p class="small">Maju &amp; sejahtera</p></div></div>'
    )


def modal(modal_id: str, education: str, jobs: list[str]) -> str:
    items = "".join(f"<li>{job}</li>" for job in jobs)
    return (
        f'<div class="modal fade" id="{modal_id}"><p><strong class="text-secondary">Tempat, Tanggal Lahir</strong><br>Kota X, 1 Januari 1970</p>'
        f'<p><strong class="text-secondary">Pendidikan Terakhir</strong><br>{education}</p>'
        f'<p class="mb-2"><strong class="text-secondary">Riwayat Pekerjaan</strong></p><ul class="pl-3">{items}</ul>'
        '<p><strong class="text-secondary">Status Hukum</strong></p><ul><li>Rahasia</li></ul></div>'
    )


class TestKpuCards:
    def test_extracts_public_campaign_facts_only(self):
        page = (
            card("2", "DR. H. BUDI, M.Si.", "SITI", 10, 11, ["Partai A", "Partai B"])
            + card("1", "ANI", "BAMBANG", 12, 13, [])
            + modal("modalCakada10", "S3", ["Dosen", "-", "Dosen"])
            + modal("modalCawakeda11", "S1", [])
        ).encode()

        pairs = parse_candidates(page)

        assert [pair.number for pair in pairs] == [1, 2]
        budi = pairs[1]
        assert budi.head.name == "DR. H. BUDI, M.Si."
        assert budi.head.last_education == "S3"
        assert budi.head.occupations == ("Dosen",)  # "-" dropped, duplicates collapsed
        assert budi.parties == ("Partai A", "Partai B")
        assert budi.vision == "Maju & sejahtera"
        # Birth date and legal status are present in the page but never part of the result.
        assert "1970" not in repr(budi) and "Rahasia" not in repr(budi)

    def test_re_run_elections_without_ballot_numbers_keep_page_order(self):
        pairs = parse_candidates((card(None, "C", "D", 1, 2, []) + card(None, "A", "B", 3, 4, [])).encode())

        assert [(pair.number, pair.head.name) for pair in pairs] == [(None, "C"), (None, "A")]

    def test_duplicate_numbers_are_rejected(self):
        with pytest.raises(ValueError, match="duplicate"):
            parse_candidates((card("1", "A", "B", 1, 2, []) + card("1", "C", "D", 3, 4, [])).encode())

    def test_empty_page_has_no_pairs(self):
        assert parse_candidates(b"") == []


WIKITEXT = """
{| class="wikitable sortable"
|-
! Regency/<br>City
! Photo
|-
| align="center" | [[File:Seal.svg|75px]]<br>[[West Bandung Regency|West Bandung<br>Regency]]<hr /><small>[[Regent of West Bandung|List of Regents]]</small>
| align="center" | [[File:Head photo.png|x150px]]
| style="background:{{Party color|National Mandate Party}}"|
| align="center" | [[Jeje Ritchie Ismail]]
| align="center" | [[File:Deputy photo.jpg|x150px]]
| style="background:{{Party color|Gerindra Party}}" |
| align="center" | [[Asep Ismail (politician)|Asep Ismail]]
| align="center" | 20 February 2025
| align="center" | 20 February 2030
| align="center" | <ref name="Presiden200225"/>
|-
| align="center" | [[File:Seal2.svg|75px]]<br>[[Bekasi Regency|Bekasi<br>Regency]]
| align="center" | [[File:Acting.png|x150px]]
| style="background:{{Party color|Labour Party (Indonesia, 2021)}}"|
| align="center" | [[Asep Surya Atmaja]]<br><small>(''Acting Officer'')</small>
| colspan="3" align="center" |
| align="center" | 20 December 2025
| align="center" | 20 February 2030
| align="center" | <ref>{{cite web|url=https://example.test|title=Plt 1 January 2020}}</ref>
|}
"""


class TestWikipediaTables:
    def test_parses_people_parties_photos_and_dates(self):
        first, second = (parse_row(row) for row in table_rows(WIKITEXT))

        assert first is not None and first.head is not None and first.deputy is not None
        assert first.region == "West Bandung Regency"
        assert (first.head.name, first.head.party, first.head.photo_file) == (
            "Jeje Ritchie Ismail",
            "National Mandate Party",
            "Head photo.png",
        )
        assert first.deputy.name == "Asep Ismail"
        assert (first.since, first.until) == ("20 February 2025", "20 February 2030")

        assert second is not None and second.head is not None
        assert second.head.acting is True
        assert second.deputy is None  # vacant deputy stays empty, never invented
        assert second.since == "20 December 2025"  # dates inside <ref> are ignored


class TestJakartaMergedDates:
    """Jakarta's administrative rows put both offices' dates in one labelled cell (real shape)."""

    ROW = (
        '| align="center" | [[File:Lambang Kota Jakarta Timur.png|pus|75px]]<br>[[East Jakarta|East Jakarta<br>Administrative City]]'
        '| align="center" | [[File:Munjirin.png|x150px]]\n'
        '| align="center" | [[Munjirin]]\n'
        '| align="center" | [[File:Kusmanto.png|x150px]]\n'
        '| align="center" | [[Kusmanto (bureaucrat)|Kusmanto]]\n'
        '| align="center" | Mayor : 7 May 2025<br> Deputy Mayor : 17 December 2025\n'
        '| rowspan="6" align="center" | \'\'Adjusting to the Decree of the [[Governor of Jakarta]]\'\'\n'
    )

    def test_labelled_merged_cell_keeps_only_the_head_start_and_an_open_term(self):
        row = parse_row(self.ROW)

        assert row is not None and row.head is not None and row.deputy is not None
        assert row.head.name == "Munjirin" and row.deputy.name == "Kusmanto"
        # The shared end-of-office cell is prose, so no planned end date exists for the region.
        assert row.since == "7 May 2025"
        assert row.until is None

    def test_unlabelled_two_date_cell_is_rejected_rather_than_guessed(self):
        row = self.ROW.replace(
            "Mayor : 7 May 2025<br> Deputy Mayor : 17 December 2025", "7 May 2025<br>17 December 2025"
        )

        with pytest.raises(ValueError, match="unlabelled merged date cell"):
            parse_row(row)


class TestMapping:
    @pytest.mark.parametrize(
        ("wiki", "expected"),
        [
            ("West Bandung Regency", "Kabupaten Bandung Barat"),
            ("North Central Timor Regency", "Kabupaten Timor Tengah Utara"),
            ("Meranti Islands Regency", "Kabupaten Kepulauan Meranti"),
            ("South Tangerang City", "Kota Tangerang Selatan"),
            ("South Jakarta", "Kota Jakarta Selatan"),
            ("South Jakarta Administrative City", "Kota Jakarta Selatan"),
        ],
    )
    def test_translates_english_names(self, wiki: str, expected: str):
        assert candidate_names(wiki)[0] == expected

    def test_matches_only_within_the_province_index(self):
        index = {"kabupatenbandungbarat": "32.17"}
        assert match_region(["West Bandung Regency"], index, {}) == "32.17"
        assert match_region(["East Bandung Regency"], index, {}) is None
        # The link target wins over a mistyped display text.
        assert match_region(["West Bandung Regency", "Garut Regency"], index, {}) == "32.17"

    def test_same_person_ignores_titles_and_degrees(self):
        assert same_person("Muhammad Farhan", "MUHAMMAD FARHAN, S.E.")
        assert same_person("Dandan Riza Wardana", "DR. H. DANDAN RIZA WARDANA, M.Si.")
        assert not same_person("Muhammad Farhan", "Arfi Rafnialdi")
        assert same_person("Iskandar Usman Al-Farlaky", "ISKANDAR USMAN AL FARLAKY")
        assert same_person("Leli Arni", "LELIARNI")
        assert same_person("Afni Zulkifli", "Dr. AFNI.Z")
        assert same_person("Respati Ardi", "Respati Achmad Ardianto")
        assert not same_person("Ahmad Syukri", "Muhammad Fadhil")

    def test_party_names_use_indonesian_forms(self):
        assert party_name("Indonesian Democratic Party of Struggle") == "PDI Perjuangan"
        assert party_name("Democratic Party (Indonesia)") == "Partai Demokrat"
        assert party_name("Gerindra Party") == "Partai Gerindra"
        assert party_name(None) is None


class TestKpuSelection:
    @staticmethod
    def election(*pairs: tuple[str, str]) -> dict[str, object]:
        return {"pairs": [{"head": {"name": head}, "deputy": {"name": deputy}} for head, deputy in pairs]}

    def test_head_prefers_its_own_slot_over_an_equally_scoring_rival_deputy(self):
        # Real Kabupaten Aceh Selatan data: "MIRWAN, S.H." in pair 3 is a different person, yet he
        # matches the incumbent head as well as pair 1's own head entry does. Ranking by score alone
        # (then pair index) picks the rival pair's deputy; the office must break the tie first.
        election = self.election(
            ("DARMANSAH, S.Pd., M.M.", "SUDIRMAN"),
            ("H. MIRWAN MS, S.E., M.Sos.", "H. BAITAL MUKADIS, S.E."),
            ("AMRAN, S.H.", "AKMAL AH, S.Pd."),
            ("HENDRI YONO, S.Sos., M.Si.", "MIRWAN, S.H."),
        )
        rival = similarity("Mirwan M. S.", "MIRWAN, S.H.")
        own = similarity("Mirwan M. S.", "H. MIRWAN MS, S.E., M.Sos.")

        assert rival == own == 1.0
        assert _kpu_match("Mirwan M. S.", election, "head") == {"pair_index": 1, "role": "head"}

    def test_own_slot_wins_even_when_the_rival_match_scores_higher(self):
        # Own-slot preference is a rule, not a tie-break: it must hold even when the rival slot is
        # the strictly better string match (a typo in the KPU head entry against an exact deputy name).
        election = self.election(("BYSTANDER", "Budi Santoso"), ("Budi Santosa", "OTHER"))
        rival = similarity("Budi Santoso", "Budi Santoso")
        own = similarity("Budi Santoso", "Budi Santosa")

        assert own < rival and own >= 0.8
        assert _kpu_match("Budi Santoso", election, "head") == {"pair_index": 1, "role": "head"}

    def test_promoted_deputy_still_matches_the_deputy_slot_of_the_winning_pair(self):
        # Acting heads that rose from the winning pair's deputy keep role "deputy" (data: 16.03, 33.01, 74.11).
        election = self.election(
            ("H. SUGIRI SANCOKO, S.E., M.M.", "LISDYARITA, S.H."),
            ("Drs. H. IPONG MUCHLISSONI", "SEGORO LUHUR KUSUMO DARU"),
        )

        assert _kpu_match("Lisdyarita", election, "head") == {"pair_index": 0, "role": "deputy"}
        assert _kpu_match("Sukirman", self.election(("SUKIRMAN, S.Pd.", "OTHER")), "head") == {
            "pair_index": 0,
            "role": "head",
        }

    def test_lowest_pair_index_breaks_a_tie(self):
        election = self.election(("SAME NAME", "A"), ("SAME NAME", "B"))

        assert _kpu_match("Same Name", election, "head") == {"pair_index": 0, "role": "head"}

    def test_below_threshold_stays_unverified(self):
        assert _kpu_match("Unrelated Person", self.election(("SOMEONE ELSE", "ANOTHER")), "head") is None
        assert _kpu_match("Anyone", None, "head") is None


def region(head: str | None, deputy: str | None, since: str | None = None) -> dict[str, object]:
    """A row in the shape `build` produces, before `_apply_overrides` runs."""
    return {
        "head": (
            None
            if head is None
            else {"name": head, "party": None, "acting": False, "photo": {"url": "https://x/a.jpg"}, "kpu": None}
        ),
        "deputy": (
            None
            if deputy is None
            else {"name": deputy, "party": None, "acting": False, "photo": None, "kpu": None}
        ),
        "since": since,
        "until": None,
        "page": "https://en.wikipedia.org/w/index.php?oldid=1364052047",
        "corrections": [],
    }


class TestOverrides:
    @staticmethod
    def csv(tmp_path, *rows: str):
        path = tmp_path / "incumbent-overrides.csv"
        path.write_text(
            "kemendagri_code,field,value,source_url,note\n" + "\n".join(rows) + "\n", encoding="utf-8"
        )
        return path

    def test_replaced_values_are_published_with_their_official_provenance(self, tmp_path):
        # The whole point of the correction record: the profile can attribute the replaced value to
        # the official page instead of the Wikipedia revision `page` still cites.
        overrides = _read_overrides(
            self.csv(
                tmp_path,
                '31.74,head_name,Syafrin Liputo,https://selatan.jakarta.go.id/pejabat,'
                '"Official page: sworn 15 April 2026, the Wikipedia row still lists his predecessor"',
                '31.74,since,2026-04-15,https://selatan.jakarta.go.id/pejabat,"Pelantikan date of the head above"',
            )
        )
        regions = {"31.74": region("M. Anwar", "Firmanudin Ibrahim", "2025-05-07")}

        _apply_overrides(regions, overrides)

        corrected = regions["31.74"]
        assert corrected["head"]["name"] == "Syafrin Liputo"
        assert corrected["since"] == "2026-04-15"
        # The replaced head's photo depicts the predecessor, and the row's own source is unchanged.
        assert corrected["head"]["photo"] is None
        assert corrected["page"] == "https://en.wikipedia.org/w/index.php?oldid=1364052047"
        assert corrected["corrections"] == [
            {
                "field": "head_name",
                "source_url": "https://selatan.jakarta.go.id/pejabat",
                "note": "Official page: sworn 15 April 2026, the Wikipedia row still lists his predecessor",
            },
            {
                "field": "since",
                "source_url": "https://selatan.jakarta.go.id/pejabat",
                "note": "Pelantikan date of the head above",
            },
        ]

    def test_a_region_without_an_override_row_records_no_correction(self, tmp_path):
        overrides = _read_overrides(self.csv(tmp_path, '31.74,since,2026-04-15,https://a.test/x,"reason"'))
        regions = {
            "31.74": region("Syafrin Liputo", "Firmanudin Ibrahim"),
            "32.73": region("Muhammad Farhan", "Erwin"),
        }

        _apply_overrides(regions, overrides)

        assert regions["32.73"]["corrections"] == []
        assert regions["32.73"]["since"] is None
        assert regions["31.74"]["corrections"] == [
            {"field": "since", "source_url": "https://a.test/x", "note": "reason"}
        ]

    def test_an_override_without_a_source_or_note_is_refused(self, tmp_path):
        with pytest.raises(ValueError, match="without source_url or note"):
            _read_overrides(self.csv(tmp_path, '31.74,head_name,Someone,,"left blank"'))

    def test_an_override_for_an_unknown_region_is_refused(self, tmp_path):
        overrides = _read_overrides(
            self.csv(tmp_path, '99.99,head_name,Someone,https://a.test/x,"reason"')
        )

        with pytest.raises(ValueError, match="unknown region 99.99"):
            _apply_overrides({"31.74": region("A", "B")}, overrides)
