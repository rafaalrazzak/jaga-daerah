from jaga_etl.welfare.match import index_regions, match_place, province_key
from jaga_etl.welfare.parse import parse_development, parse_output, parse_poverty

POVERTY = """
11
1 Simeulue 15,58 15,52 2,227 0,458 586.505
2 Aceh Selatan 25,39 9,89 1,552 0,461 538.174
Aceh 704,69 12,33 1,836 0,420 676.247
8
Ogan Komering Ulu
Selatan 35,49 9,17 1,273 0,265 456.280
9 Ogan Komering Ulu Timur 62,89 8,86 0,967 0,179 453.488
Sumatera
Selatan 919,60 10,15 1,642 0,371 581.702
9 Pangkajene Dan Kepu-
lauan 40,37 11,60 1,077 0,180 471.043
1 Bangka 16,58 4,71 0,507 0,085 734.575
Bangka Belitung 77,71 5,00 0,649 0,136 956.833
"""

OUTPUT = """
01. Kab. Simeulue   10.000   11.000   12.000   13.000   14.000
Tabel/Table  1
PDRB Provinsi Aceh Atas Dasar Harga Berlaku Menurut Kabupaten/Kota
01. Kab. Aceh Selatan   21.000   22.000   23.000   24.000   32.867
Tabel/Table  153
PDRB Per Kapita Atas Dasar Harga Berlaku di Provinsi Aceh
01. Kab. Nias   28.240   29.921   31.614   34.085   35.990
PDRB Per Kapita Atas Dasar Harga Berlaku di Provinsi Sumatera Utara
Tabel/Table  154
01. Kab. Merauke   70.507   74.154 – – –
Tabel/Table  187
PDRB Per Kapita Atas Dasar Harga Berlaku di Provinsi Papua Selatan
"""

DEVELOPMENT = """
ACEH 73,48 14,40 9,95 11.191 76,23 1,15
Simeulue 69,92 14,59 10,09 8.555 71,94 1,40
Kota Banda Aceh 75,74 17,95 13,37 18.356 89,55 0,79
KALIMANTAN SELATAN 74,00 13,00 9,00 12.000 75,00 1,00
Kota Baru 70,00 12,00 8,00 9.000 71,00 1,00
INDONESIA 71,00 13,00 9,00 12.000 75,90 0,83
"""

REGIONS = [
    {"code": "11.01", "name": "Kabupaten Aceh Selatan", "province": {"code": "11", "name": "Aceh"}},
    {"code": "11.09", "name": "Kabupaten Simeulue", "province": {"code": "11", "name": "Aceh"}},
    {"code": "11.71", "name": "Kota Banda Aceh", "province": {"code": "11", "name": "Aceh"}},
    {
        "code": "16.09",
        "name": "Kabupaten Ogan Komering Ulu Selatan",
        "province": {"code": "16", "name": "Sumatera Selatan"},
    },
    {
        "code": "16.08",
        "name": "Kabupaten Ogan Komering Ulu Timur",
        "province": {"code": "16", "name": "Sumatera Selatan"},
    },
    {"code": "19.01", "name": "Kabupaten Bangka", "province": {"code": "19", "name": "Kepulauan Bangka Belitung"}},
    {"code": "63.02", "name": "Kabupaten Kotabaru", "province": {"code": "63", "name": "Kalimantan Selatan"}},
    {"code": "93.01", "name": "Kabupaten Merauke", "province": {"code": "93", "name": "Papua Selatan"}},
]


def test_poverty_joins_a_wrapped_name_and_keeps_the_printed_thousands():
    names = {province_key(name) for name in ("Aceh", "Sumatera Selatan", "Kepulauan Bangka Belitung", "Sulawesi Selatan")}
    rows = {(row.province_name, row.name): row for row in parse_poverty(POVERTY, names)}
    simeulue = rows[("Aceh", "Simeulue")]
    assert simeulue.people_thousands == "15.58"
    assert simeulue.percent == "15.52"
    assert simeulue.line_rupiah == 586505
    assert ("Sumatera Selatan", "Ogan Komering Ulu Selatan") in rows
    assert ("Kepulauan Bangka Belitung", "Bangka") in rows or ("Bangka Belitung", "Bangka") in rows


def test_output_ignores_the_total_pdrb_table_and_a_missing_2025():
    rows = parse_output(OUTPUT)
    assert [(row.name, row.per_person_thousands) for row in rows] == [
        ("Kab. Aceh Selatan", 32867),
        ("Kab. Nias", 35990),
        ("Kab. Merauke", None),
    ]


def test_development_treats_a_capitalised_line_as_the_province():
    rows = [(row.province_name, row.name, row.index) for row in parse_development(DEVELOPMENT)]
    assert ("ACEH", "Simeulue", "71.94") in rows
    assert ("KALIMANTAN SELATAN", "Kota Baru", "71.00") in rows
    assert all(row[0] != "INDONESIA" for row in rows)


def test_names_match_kemendagri_codes_including_the_kotabaru_spelling():
    provinces, places = index_regions(REGIONS)
    assert match_place(provinces, places, "Bangka Belitung", "Bangka") == "19.01"
    assert match_place(provinces, places, "KALIMANTAN SELATAN", "Kota Baru") == "63.02"
    assert match_place(provinces, places, "Sumatera Selatan", "Ogan Komering Ulu Selatan") == "16.09"
    assert match_place(provinces, places, "Papua Selatan", "Kab. Merauke") == "93.01"
    assert match_place(provinces, places, "Aceh", "Kab. Simeulue") == "11.09"
