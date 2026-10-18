"""Turn human-saved captures into `apps/web/src/data/lhkpn.json`, or refuse to.

The capture directory is the only input, and every figure must be traceable to one file: the worklist
says which searches a human was asked to run, `provenance.csv` pins the SHA-256 of the bytes that human
saved, and only then does a capture become publishable. A capture that cannot be read, an institution
missing from the reviewed CSV or belonging to another region, two captures claiming a region with
different figures, an amount that is not a positive rupiah figure, or a row without the labels
`docs/decisions/0003` requires all block the build instead of producing figures — a figure that cannot
be published is a "belum tersedia" state, never a guess.
"""

import csv
import hashlib
import json
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.facts.djpk.mapping import name_key
from jaga_etl.incumbents.mapping import same_person
from jaga_etl.lhkpn.parse import CaptureError, CaptureRow, parse_amount, read_capture
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]
REFERENCE = ETL_ROOT / "reference"
CAPTURES = ETL_ROOT / "data" / "captures"
INSTITUTIONS = REFERENCE / "lhkpn-institutions.csv"
WORKLIST_NAME = "worklist.csv"
PROVENANCE_NAME = "provenance.csv"
HEADERS = ["region_code", "file", "sha256", "registered_at"]
# Every institution that may publish a figure is a regional government filing under its own name, so
# `PEMERINTAH KABUPATEN BOGOR` names the regency outright. Anything else in a results table — the KPUD
# or DPRD a person filed under before taking office — is not a regional government, and the gate stops
# on it rather than deciding where that figure belongs (see `data/captures/README.md`, worked example).
GOVERNMENT_PREFIX = "PEMERINTAH "
# How KPK prints the office a regional head holds, per region type; the row for the office in office
# today is identified by this title, not by the newest year in the table.
OFFICE_TITLES = {"kabupaten": "BUPATI", "kota": "WALI KOTA"}
# KPK's e-LHKPN portal: the publisher of every figure, and the only official address this repository
# can cite, because the capture format verified no per-announcement deep link.
SOURCE_URL = "https://elhkpn.kpk.go.id/"
# The four labels ADR 0003 requires together on every figure; one missing label rejects the row.
LABELS = ("year", "position", "source", "processed_at")
NOTES = (
    "Total harta kekayaan adalah angka bersih seperti yang diterbitkan KPK (aset dikurangi utang yang "
    'dideklarasikan; tampilan perbandingan KPK menulisnya "TOTAL HARTA KEKAYAAN (I-II)"). Angka ini '
    "bukan hasil audit dan JagaDaerah bukan penerbitnya. Rincian aset dan utang tidak disalin."
)


@dataclass(frozen=True)
class Capture:
    """One capture file a human saved, pinned to the region the worklist asked for."""

    file: str
    region_code: str
    sha256: str
    registered_at: str


@dataclass(frozen=True)
class Region:
    code: str
    name: str
    type: str
    official: str | None


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as file:
        return [row for row in csv.DictReader(file)]


def read_institutions(path: Path = INSTITUTIONS) -> dict[str, str]:
    """Reviewed `Lembaga` → Kemendagri code. The only source a figure's region may come from."""
    return {name_key(row["lembaga"]): row["region_code"] for row in _read_csv(path)}


def read_worklist(path: Path = CAPTURES / WORKLIST_NAME) -> dict[str, str]:
    """Capture file → region code, as the human was asked to run the searches."""
    return {row["capture_file"]: row["region_code"] for row in _read_csv(path)}


def read_provenance(path: Path = CAPTURES / PROVENANCE_NAME) -> dict[str, Capture]:
    """Capture file → the record that makes its bytes publishable; `sha256` is the whole point."""
    return {
        row["file"]: Capture(row["file"], row["region_code"], row["sha256"], row["registered_at"])
        for row in _read_csv(path)
    }


def read_regions(regions_file: Path, officials_file: Path) -> dict[str, Region]:
    """The Kemendagri regions plus the head in office the worklist searched for, by region code."""
    officials = json.loads(officials_file.read_text(encoding="utf-8"))["regions"]
    regions: dict[str, Region] = {}
    for region in json.loads(regions_file.read_text(encoding="utf-8")):
        head = officials.get(region["code"], {}).get("head")
        regions[region["code"]] = Region(
            code=region["code"],
            name=region["name"],
            type=region["type"],
            official=head["name"] if head else None,
        )
    return regions


def suggested_lembaga(region_name: str) -> str:
    """KPK lists a regional government as `PEMERINTAH <NAMA DAERAH>` ("Kabupaten Bogor" → uppercase)."""
    return GOVERNMENT_PREFIX + region_name.upper()


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _stamp() -> str:
    return datetime.now(UTC).isoformat()


def _capture_files(captures_dir: Path) -> list[str]:
    return sorted(path.name for path in captures_dir.glob("*.html")) if captures_dir.exists() else []


def worklist_rows(*, limit: int, regions: dict[str, Region]) -> list[dict[str, str]]:
    """The searches a human must run, in region-code order, so a pilot covers a known set of regions."""
    rows: list[dict[str, str]] = []
    for code, region in sorted(regions.items()):
        if limit and len(rows) >= limit:
            break
        if region.official is not None:
            rows.append(
                {
                    "region_code": code,
                    "region": region.name,
                    "official": region.official,
                    "search_lembaga": suggested_lembaga(region.name),
                    "capture_file": f"{code}.html",
                }
            )
    return rows


def write_worklist(rows: list[dict[str, str]], captures_dir: Path = CAPTURES) -> None:
    """The worklist as a CSV a script can read, plus the Markdown a human actually follows."""
    captures_dir.mkdir(parents=True, exist_ok=True)
    fields = ["region_code", "region", "official", "search_lembaga", "capture_file"]
    with (captures_dir / WORKLIST_NAME).open("w", encoding="utf-8", newline="\n") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    (captures_dir / "README.worklist.md").write_text(
        _worklist_markdown(rows, captures_dir), encoding="utf-8", newline="\n"
    )


def _worklist_markdown(rows: list[dict[str, str]], captures_dir: Path) -> str:
    return "\n".join(
        [
            "# Daftar kerja pencarian LHKPN (pilot)",
            "",
            "Satu baris = satu pencarian yang dijalankan **manusia** di browser. Pipeline ini tidak",
            "pernah memanggil pencarian e-Announcement sendiri: formulirnya dilindungi reCAPTCHA dan",
            "aturan repositori melarang melewatinya (`README.md` di direktori ini mencatat alasan dan",
            "buktinya).",
            "",
            "Langkah per baris:",
            "",
            "1. Buka <https://elhkpn.kpk.go.id/> dan masuk ke menu **e-Announcement**.",
            "2. Isi **Nama** dengan kolom `official`, lalu pilih **Lembaga** di dropdown sesuai kolom",
            "   `search_lembaga` (filter institusi inilah yang membuat angka pasti milik satu daerah).",
            "3. Selesaikan reCAPTCHA sendiri, lalu cari.",
            "4. Simpan halaman hasilnya sebagai berkas bernama kolom `capture_file` di direktori ini.",
            "",
            "| Daerah | Kode | Pejabat (nama dicari) | Lembaga (pilih di dropdown) | Simpan sebagai |",
            "| ------ | ---- | --------------------- | --------------------------- | -------------- |",
            *(
                f"| {row['region']} | {row['region_code']} | {row['official']} | `{row['search_lembaga']}`"
                f" | `{row['capture_file']}` |"
                for row in rows
            ),
            "",
            "Lalu daftarkan berkasnya dan bangun:",
            "",
            "```sh",
            "uv run python -m jaga_etl.lhkpn register",
            "uv run python -m jaga_etl.lhkpn build",
            "```",
            "",
            "Saring dengan **Lembaga** saat mencari. Baris dari institusi non-pemerintah daerah (KPUD,",
            "DPRD, partai) berasal dari jabatan lain; baris seperti itu menghentikan build, bukan ikut",
            "diterbitkan dengan jabatan yang keliru.",
            "",
            "Direktori ini dan seluruh isinya diabaikan git: halaman hasil memuat angka nyata dan data",
            "pribadi pihak ketiga, sedangkan yang masuk repositori hanya",
            "`apps/web/src/data/lhkpn.json`.",
            "",
        ]
    )


def register(captures_dir: Path = CAPTURES) -> tuple[list[Capture], list[str]]:
    """Record the SHA-256 of every capture the worklist names, and of nothing else.

    A registered hash is what makes a saved page publishable: it is computed over the exact bytes the
    human saved, so any later edit to the file is detectable and no figure can be traced to a file
    nobody reviewed.
    """
    worklist = read_worklist(captures_dir / WORKLIST_NAME)
    if not worklist:
        return [], [f"no worklist in {captures_dir}: run the `captures` subcommand first"]
    known = read_provenance(captures_dir / PROVENANCE_NAME)
    registered: list[Capture] = []
    errors: list[str] = []
    for name in _capture_files(captures_dir):
        if name not in worklist:
            errors.append(f"{name}: capture that no worklist row asks for; remove it or rerun the worklist")
            continue
        digest = _digest(captures_dir / name)
        previous = known.get(name)
        if previous is not None and previous.sha256 != digest:
            print(f"{name}: bytes changed since {previous.registered_at}; re-registering {digest[:12]}…")
        registered.append(Capture(name, worklist[name], digest, _stamp()))
    if not registered:
        errors.append(f"nothing to register: save a results page into {captures_dir} first")
    return registered, errors


def write_provenance(captures: list[Capture], path: Path = CAPTURES / PROVENANCE_NAME) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        writer = csv.DictWriter(file, fieldnames=HEADERS)
        writer.writeheader()
        for capture in captures:
            writer.writerow(
                {
                    "region_code": capture.region_code,
                    "file": capture.file,
                    "sha256": capture.sha256,
                    "registered_at": capture.registered_at,
                }
            )


def _published_report(row: CaptureRow, where: str, errors: list[str]) -> dict[str, object] | None:
    """One publishable report with its ADR 0003 labels, or None with the reason in `errors`."""
    labels = {"year": row.year, "position": row.position, "source": SOURCE_URL, "processed_at": _stamp()}
    missing = [label for label in LABELS if not labels[label]]
    if missing:
        errors.append(f"{where}: {row.name} is missing {', '.join(missing)}")
        return None
    if not row.announcement_id:
        errors.append(f"{where}: {row.name} carries no announcement id")
        return None
    try:
        amount = parse_amount(row.amount)
    except CaptureError as error:
        errors.append(f"{where}: {row.name}: {error}")
        return None
    return {
        "year": row.year,
        "position": row.position,
        "total_assets": amount,
        "report_type": row.report_type or row.report_code,
        "source": SOURCE_URL,
        "announcement_id": row.announcement_id,
        "reported_on": row.reported_on or None,
    }


def _capture_reports(
    capture: Capture,
    region: Region,
    institutions: dict[str, str],
    captures_dir: Path,
    errors: list[str],
) -> tuple[dict[str, dict[str, object]], str, str] | None:
    """(reports by announcement id, Lembaga as published, official's name) for one capture, or None."""
    where = f"{capture.file} ({capture.region_code})"
    path = captures_dir / capture.file
    if not capture.sha256:
        errors.append(f"{where}: provenance records no SHA-256 — re-run the register subcommand")
        return None
    if not path.exists():
        errors.append(f"{where}: registered capture is missing from the capture directory")
        return None
    digest = _digest(path)
    if digest != capture.sha256:
        errors.append(f"{where}: bytes are {digest[:12]}… but provenance records {capture.sha256[:12]}…")
        return None
    try:
        rows = read_capture(path)
    except CaptureError as error:
        errors.append(str(error))
        return None

    lembagas = {row.lembaga for row in rows}
    outside = sorted({row.lembaga for row in rows if not row.lembaga.startswith(GOVERNMENT_PREFIX)})
    if outside:
        errors.append(
            f"{where}: {'; '.join(repr(name) for name in outside)} is not a regional government;"
            " search again with the Lembaga filter set to the regional government"
        )
        return None
    unknown = sorted(lembaga for lembaga in lembagas if name_key(lembaga) not in institutions)
    if unknown:
        errors.append(
            f"{where}: Lembaga {'; '.join(repr(name) for name in unknown)} is not in {INSTITUTIONS.name}"
            " — add a reviewed row"
        )
        return None
    wrong = sorted({institutions[name_key(lembaga)] for lembaga in lembagas} - {capture.region_code})
    if wrong:
        errors.append(f"{where}: Lembaga maps to {wrong}, not to region {capture.region_code}")
        return None
    if len(lembagas) != 1:
        errors.append(
            f"{where}: rows name {len(lembagas)} institutions ({sorted(lembagas)});"
            " narrow the search by Lembaga so one capture is one regional government"
        )
        return None
    if region.official is None:
        errors.append(f"{where}: no regional head on record to match the capture against")
        return None

    # A regional government's results table may hold several people (a deputy, other officials of the
    # same institution). The published record is about the head in office, so only that person's rows
    # become figures; the rest are left out and named, never reattributed to the head.
    mine = [row for row in rows if same_person(row.name, region.official)]
    others = sorted({row.name for row in rows if not same_person(row.name, region.official)})
    if not mine:
        errors.append(f"{where}: no row matches the region's head {region.official!r}")
        return None
    if others:
        print(f"{where}: skipping rows for {', '.join(others)} (not this region's head)", file=sys.stderr)

    reports: dict[str, dict[str, object]] = {}
    for row in mine:
        report = _published_report(row, where, errors)
        if report is not None:
            reports.setdefault(row.announcement_id, report)
    if not reports:
        errors.append(f"{where}: no publishable row")
        return None
    return reports, lembagas.pop(), region.official


def _merge(
    claims: dict[str, tuple[dict[str, dict[str, object]], str, str]],
    capture: Capture,
    reports: dict[str, dict[str, object]],
    lembaga: str,
    official: str,
    errors: list[str],
) -> None:
    """One region, one capture. A second capture for the same region must agree row for row."""
    existing = claims.get(capture.region_code)
    if existing is None:
        claims[capture.region_code] = (reports, lembaga, official)
        return
    if json.dumps(existing[0], sort_keys=True) != json.dumps(reports, sort_keys=True):
        errors.append(f"{capture.region_code}: two captures claim this region with conflicting figures")


def _latest(reports: list[dict[str, object]], region: Region, where: str, errors: list[str]) -> dict[str, object] | None:
    """The newest report for the office held now — never blindly the newest year in the table.

    A person's results page also holds rows for earlier offices (a 2023 "KETUA DPRD" figure, a 2024
    "CALON BUPATI" figure). Those years stay in `reports`, each labelled with its own position, but
    only a row carrying the office held today can be the headline figure.
    """
    title = OFFICE_TITLES[region.type]
    matching = [report for report in reports if report["position"].casefold() == title.casefold()]
    if not matching:
        errors.append(
            f"{where}: no row states the office held now ({title}); the capture has"
            f" {sorted({report['position'] for report in reports})}"
        )
        return None
    return max(matching, key=lambda report: (report["year"], report["announcement_id"]))


def build(
    *,
    captures_dir: Path = CAPTURES,
    institutions_file: Path = INSTITUTIONS,
    officials_file: Path,
    regions_file: Path,
) -> tuple[dict[str, object], list[str]]:
    """The payload to publish and every reason not to (an empty error list means publish)."""
    institutions = read_institutions(institutions_file)
    worklist = read_worklist(captures_dir / WORKLIST_NAME)
    provenance = read_provenance(captures_dir / PROVENANCE_NAME)
    regions_by_code = read_regions(regions_file, officials_file)
    errors: list[str] = []
    claims: dict[str, tuple[dict[str, dict[str, object]], str, str]] = {}

    for name in _capture_files(captures_dir):
        if name not in provenance:
            errors.append(f"{name}: capture has no provenance record — run the register subcommand first")
    for name, capture in sorted(provenance.items()):
        if worklist.get(name) != capture.region_code:
            errors.append(f"{name}: registered for region {capture.region_code}, which no worklist row asks for")
            continue
        region = regions_by_code.get(capture.region_code)
        if region is None:
            errors.append(f"{name}: region code {capture.region_code} is not a known region")
            continue
        built = _capture_reports(capture, region, institutions, captures_dir, errors)
        if built is not None:
            _merge(claims, capture, *built, errors)

    published: dict[str, dict[str, object]] = {}
    for code, (reports, lembaga, official) in sorted(claims.items()):
        ordered = sorted(reports.values(), key=lambda report: (report["year"], report["announcement_id"]))
        latest = _latest(ordered, regions_by_code[code], f"{code}.html", errors)
        if latest is None:
            continue
        capture = provenance[f"{code}.html"]
        published[code] = {
            "region_code": code,
            "lembaga": lembaga,
            "official": official,
            "reports": ordered,
            "latest": latest,
            "capture_file": f"{code}.html",
            "capture_sha256": capture.sha256,
            "downloaded_at": datetime.fromtimestamp((captures_dir / f"{code}.html").stat().st_mtime, UTC).isoformat(),
            "processed_at": capture.registered_at,
            "notes": NOTES,
        }
    # One rejected capture blocks the whole publication: half a run's figures, with the reason for the
    # other half only in stderr, is exactly the partial publication the ETL rules forbid.
    if errors:
        published = {}
    return {
        "source": {
            "publisher": "Komisi Pemberantasan Korupsi (KPK)",
            "title": "e-Announcement LHKPN",
            "url": SOURCE_URL,
            "processed_at": _stamp(),
        },
        "regions": published,
    }, errors


def write_payload(payload: dict[str, object], output: Path) -> None:
    """`write_json` keeps two-space indent and LF, so `bun run format:check` accepts the artifact."""
    write_json(output, payload)
