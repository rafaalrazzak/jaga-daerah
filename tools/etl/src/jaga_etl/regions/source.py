"""Pinned upstream source for administrative region codes.

The legal authority is Kepmendagri No. 300.2.2-2138 Tahun 2025 as amended by
No. 300.2.2-2430 Tahun 2025 (23 June 2025). The official attachment is a scanned PDF, so the
machine-readable input is the MIT-licensed transcription maintained in cahyadsn/wilayah, pinned
to an exact commit and checksum. Its per-province kabupaten/kota counts are cross-checked
against the official recap table (Lampiran A of 300.2.2-2430) before anything is loaded.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PinnedSource:
    publisher: str
    title: str
    legal_basis: str
    url: str
    official_document_url: str
    license: str
    commit: str
    sha256: str
    max_bytes: int


REGION_CODE_SOURCE = PinnedSource(
    publisher="cahyadsn/wilayah (transkripsi Kepmendagri)",
    title="Kode dan Data Wilayah Administrasi Pemerintahan (wilayah.sql)",
    legal_basis="Kepmendagri No. 300.2.2-2138 Tahun 2025 jo. No. 300.2.2-2430 Tahun 2025",
    url=(
        "https://raw.githubusercontent.com/cahyadsn/wilayah/"
        "d68e8d5516f969d1905d0b2940f20034becb0db7/db/wilayah.sql"
    ),
    official_document_url=(
        "https://ditjenbinaadwil.kemendagri.go.id/download/file/Kepmen_Perubahan_300.2.2-2430.pdf"
    ),
    license="MIT",
    commit="d68e8d5516f969d1905d0b2940f20034becb0db7",
    sha256="c4c3396d9380d4edee072af1d9dff83573b574d7cd00a6562cf82e200e954031",
    # Upstream file is ~2.9 MB; refuse anything far larger instead of streaming it blindly.
    max_bytes=10 * 1024 * 1024,
)
