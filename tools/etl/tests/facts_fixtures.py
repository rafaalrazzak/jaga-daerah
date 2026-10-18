"""Small, deterministic DJPK/BNPB snapshots shaped like the real portals (no network)."""

import json
from pathlib import Path

from jaga_etl.facts.bnpb.source import DISASTER_COLUMNS, RESOURCES, BnpbResource, resource_file_name
from jaga_etl.facts.djpk.mapping import KemendagriProvince, KemendagriRegion
from jaga_etl.snapshot import SnapshotWriter

YEARS = (2024, 2025)
PROVINCES = [KemendagriProvince("11", "Aceh"), KemendagriProvince("32", "Jawa Barat")]
REGIONS = [
    KemendagriRegion("11.71", "Kota Banda Aceh", "11"),
    KemendagriRegion("32.04", "Kabupaten Bandung", "32"),
    KemendagriRegion("32.73", "Kota Bandung", "32"),
]

# (djpk province, pemda) → (name, Belanja Daerah anggaran, realisasi, persentase) or None (no row).
BUDGETS: dict[tuple[str, str], tuple[str, str, str, str] | None] = {
    ("01", "15"): ("Kota Banda Aceh", "1500000000000", "0", "0"),
    ("10", "01"): ("Kab. Bandung", "6.5432109876543E+12", "6.0E+12", "91.70"),
    ("10", "17"): ("Kota Bandung", "8345231335444.9", "7490617461211.1", "89.76"),
}
DJPK_PROVINCES = {"01": "Aceh", "10": "Jawa Barat"}

# Jenis belanja rows printed between "Belanja Daerah" and "Pembiayaan Daerah", per (province, pemda).
# The source prints Belanja Pegawai/Barang dan Jasa/Modal twice and nests the trailing jenis under
# "Belanja Lainnya"; the fixture reproduces both quirks. Kota Bandung carries its real 2025 figures,
# whose printed rounding leaves the sum 0.03 short of the published total — the case that proves the
# tolerance is required and sufficient. Kab. Bandung is deliberately short a jenis so the gate blocks.
EXPENDITURES: dict[tuple[str, str], list[tuple[str, str, str]]] = {
    ("10", "17"): [
        ("Belanja Pegawai", "2884410615525", "2739791512799"),
        ("Belanja Pegawai", "2884410615525", "2739791512799"),
        ("Belanja Barang dan Jasa", "3961088112461.6", "3451980612625.1"),
        ("Belanja Barang dan Jasa", "3961088112461.6", "3451980612625.1"),
        ("Belanja Modal", "1016746332144.7", "916847678592"),
        ("Belanja Modal", "1016746332144.7", "916847678592"),
        ("Belanja Lainnya", "482986275313.63", "381997657195"),
        ("Belanja Hibah", "350833470000", "339497718658"),
        ("Belanja Bantuan Sosial", "43853360000", "41530230000"),
        ("Belanja Tidak Terduga", "88299445313.63", "969708537"),
    ],
    ("01", "15"): [
        ("Belanja Pegawai", "1000000000000", "0"),
        ("Belanja Barang dan Jasa", "400000000000", "0"),
        ("Belanja Modal", "100000000000", "0"),
    ],
    ("10", "01"): [
        # Kab. Bandung publishes its budget in reduced precision (6.5432109876543E+12 → ...654.30).
        ("Belanja Pegawai", "3000000000000", "3000000000000"),
        ("Belanja Barang dan Jasa", "3000000000000", "3000000000000"),
        ("Belanja Modal", "543210987654.3", "0"),
    ],
}

# The same pemda with one jenis short, so its subtotals no longer reach the published total. The
# gate must block; the fixture proves it rather than asserting on the happy path alone.
UNRECONCILED_EXPENDITURES: dict[tuple[str, str], list[tuple[str, str, str]]] = {
    **EXPENDITURES,
    ("10", "01"): [("Belanja Pegawai", "1000", "1000")],
}

# TKDD rows (account, anggaran, realisasi) per (djpk province, pemda); others get only non-SDA lines.
TKDD_ROWS: dict[tuple[str, str], list[tuple[str, str, str]]] = {
    ("10", "17"): [
        ("DBH SDA Minyak Bumi 15%", "12,50 M", "12,50 M"),
        ("DBH SDA Gas Bumi 30%", "3,25 M", "3,00 M"),
        ("DBH SDA Panas Bumi - Iuran Tetap", "1.200,00 M", "1.150,40 M"),
        ("DBH SDA Panas Bumi - Setoran Bagian Pemerintah", "0,10 M", "0,10 M"),
    ],
    ("10", "01"): [("Dana Bagi Hasil Perkebunan Sawit", "0,00 M", "0,00 M")],
}


def _cell(kind: str, value: str) -> str:
    return f'<Cell><Data ss:Type="{kind}">{value}</Data></Cell>'


def spreadsheet(rows: list[tuple[str, str, str, str]]) -> bytes:
    header = "<Row>" + "".join(_cell("String", h) for h in ("Akun", "Anggaran", "Realisasi", "Persentase")) + "</Row>"
    body = "".join(
        "<Row>" + _cell("String", f" {account}") + _cell("Number", budget) + _cell("Number", real) + _cell("String", pct) + "</Row>"
        for account, budget, real, pct in rows
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
        'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Data APBD"><Table>'
        f"{header}{body}</Table></Worksheet></Workbook>"
    ).encode()


def apbd_rows(entry: tuple[str, str, str, str] | None, expenditures: list[tuple[str, str, str]]) -> list[tuple[str, str, str, str]]:
    """The rows DJPK prints around Belanja Daerah: the total, then its jenis children, then financing."""
    rows = [("Pendapatan Daerah", "1", "1", "100.00")]
    if entry is not None:
        rows.append(("Belanja Daerah", entry[1], entry[2], entry[3]))
        # Every jenis row carries a percentage in the real export; the percentage check only reads
        # the Belanja Daerah row, so the value here is inconsequential but shape-accurate.
        rows.extend((account, budget, real, "0.00") for account, budget, real in expenditures)
    rows.append(("Pembiayaan Daerah", "0", "0", "0"))
    return rows


def tkdd_spreadsheet(rows: list[tuple[str, str, str]]) -> bytes:
    header = "<Row>" + "".join(_cell("String", h) for h in ("Akun", "Anggaran", "Realisasi", "Persentase")) + "</Row>"
    lines = [("TRANSFER KE DAERAH", "10,00 M", "9,00 M"), ("Dana Bagi Hasil", "5,00 M", "5,00 M"), *rows, ("DBH PPh Pasal 21", "1,00 M", "1,00 M")]
    body = "".join(
        "<Row>" + _cell("String", account) + _cell("String", budget) + _cell("String", real) + _cell("String", "100.00") + "</Row>"
        for account, budget, real in lines
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
        'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Data Export"><Table>'
        f"{header}{body}</Table></Worksheet></Workbook>"
    ).encode()


def djpk_contents(
    budgets: dict[tuple[str, str], tuple[str, str, str, str] | None] = BUDGETS,
    tkdd: dict[tuple[str, str], list[tuple[str, str, str]]] = TKDD_ROWS,
    expenditures: dict[tuple[str, str], list[tuple[str, str, str]]] = EXPENDITURES,
) -> dict[str, bytes]:
    contents: dict[str, bytes] = {}
    for year in YEARS:
        options = "".join(f'<option value="{code}">Provinsi {name}</option>' for code, name in DJPK_PROVINCES.items())
        contents[f"provinces-{year}.html"] = f'<select id="sel_provinsi"><option value="--">Semua</option>{options}</select>'.encode()
        for province_code, province_name in DJPK_PROVINCES.items():
            pemda = {"00": f"Provinsi {province_name}", "--": "Semua pemda"}
            for (p, d), entry in budgets.items():
                if p != province_code:
                    continue
                pemda[d] = entry[0] if entry is not None else f"Pemda {d}"
                rows = apbd_rows(entry, expenditures.get((p, d), []))
                contents[f"apbd-{year}-{p}-{d}.xml"] = spreadsheet(rows)
                contents[f"tkdd-{year}-{p}-{d}.xml"] = tkdd_spreadsheet(tkdd.get((p, d), []) if year == 2025 else [])
            contents[f"pemda-{year}-{province_code}.json"] = json.dumps(pemda).encode()
    return contents


# province code → disaster type → (events, deaths, missing, affected); None = blank cell.
def disaster_values(province: str, year: int, disaster_type: str) -> tuple[int | None, int, int, int]:
    base = (int(province) + year % 100 + len(disaster_type)) % 7
    events = None if (province, disaster_type) == ("11", "tsunami") else base
    return events, base % 3, 0, base * 100


def bnpb_payload(resource: BnpbResource, provinces: list[KemendagriProvince], tamper_total: bool = False) -> bytes:
    metric_index = ("event_count", "deaths", "missing", "affected").index(resource.metric)
    records: list[dict[str, object]] = []
    totals = dict.fromkeys(DISASTER_COLUMNS, 0)
    for number, province in enumerate(provinces, start=1):
        record: dict[str, object] = {"No.": number, "Kode Wilayah Provinsi": int(province.code), "Provinsi": province.name.upper()}
        for column, disaster_type in DISASTER_COLUMNS.items():
            value = disaster_values(province.code, resource.year, disaster_type)[metric_index]
            record[column] = value
            totals[column] += value or 0
        records.append(record)
    if tamper_total:
        totals["BANJIR"] += 1
    records.append({"No.": None, "Kode Wilayah Provinsi": None, "Provinsi": "INDONESIA", **totals})
    return json.dumps({"success": True, "result": {"total": len(records), "records": records}}).encode()


def bnpb_contents(tamper_total: bool = False) -> dict[str, bytes]:
    return {resource_file_name(r): bnpb_payload(r, PROVINCES, tamper_total) for r in RESOURCES}


def write_snapshot(root: Path, source: str, contents: dict[str, bytes], snapshot_id: str = "fixture") -> Path:
    writer = SnapshotWriter(root, source, snapshot_id)
    for name, content in sorted(contents.items()):
        writer.add(name, f"https://example.test/{name}", content)
    writer.seal()
    return writer.directory
