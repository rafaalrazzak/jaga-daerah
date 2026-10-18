"""Download the pinned source once, verify it, and record provenance next to the raw file."""

import hashlib
import json
import urllib.request
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.regions.source import PinnedSource

DOWNLOAD_TIMEOUT_SECONDS = 60


class ChecksumMismatchError(Exception):
    pass


@dataclass(frozen=True)
class RawFile:
    path: Path
    sha256: str
    downloaded_at: str
    source_url: str


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def extract(source: PinnedSource, raw_directory: Path) -> RawFile:
    """Return the verified raw file, downloading it only when no verified copy exists.

    Raw files are immutable: an existing file with the pinned checksum is reused, and a file
    with a different checksum is never overwritten.
    """
    raw_directory.mkdir(parents=True, exist_ok=True)
    raw_path = raw_directory / f"wilayah-{source.commit[:12]}.sql"
    provenance_path = raw_path.with_suffix(".provenance.json")

    if raw_path.exists():
        content = raw_path.read_bytes()
        if _sha256(content) != source.sha256:
            raise ChecksumMismatchError(f"{raw_path} exists but does not match the pinned checksum.")
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        return RawFile(
            path=raw_path,
            sha256=source.sha256,
            downloaded_at=provenance["downloaded_at"],
            source_url=source.url,
        )

    # The URL is a pinned constant, never user input; the checksum below rejects any other content.
    with urllib.request.urlopen(source.url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        content = response.read(source.max_bytes + 1)
    if len(content) > source.max_bytes:
        raise ValueError(f"Source exceeds {source.max_bytes} bytes; refusing to process it.")

    digest = _sha256(content)
    if digest != source.sha256:
        raise ChecksumMismatchError(
            f"Downloaded checksum {digest} does not match pinned {source.sha256}."
        )

    raw_file = RawFile(
        path=raw_path,
        sha256=digest,
        downloaded_at=datetime.now(UTC).isoformat(),
        source_url=source.url,
    )
    raw_path.write_bytes(content)
    provenance_path.write_text(
        json.dumps(
            {**asdict(source), "downloaded_at": raw_file.downloaded_at, "sha256": digest},
            indent=2,
        ),
        encoding="utf-8",
    )
    return raw_file
