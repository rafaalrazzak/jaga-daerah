"""Immutable raw-file snapshots with provenance.

A snapshot is one directory per source and download date holding the raw responses plus a
`manifest.json` (URL, SHA-256, size, fetch time per file). Snapshots are never modified after
being sealed, so a publication can always be reproduced from the exact bytes it used.
"""

import hashlib
import json
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

MANIFEST_NAME = "manifest.json"
PARTIAL_SUFFIX = ".partial"


@dataclass(frozen=True)
class SnapshotFile:
    name: str
    url: str
    sha256: str
    bytes: int
    fetched_at: str


@dataclass(frozen=True)
class Manifest:
    source: str
    created_at: str
    sealed: bool
    files: list[SnapshotFile]

    @property
    def checksum(self) -> str:
        """Stable digest over every file's name and SHA-256: identifies the snapshot's content."""
        digest = hashlib.sha256()
        for file in sorted(self.files, key=lambda item: item.name):
            digest.update(f"{file.name}\0{file.sha256}\n".encode())
        return digest.hexdigest()


class SnapshotError(Exception):
    pass


class SnapshotWriter:
    """Writes one snapshot. Thread-safe `add`; `resume=True` continues an interrupted, unsealed one."""

    def __init__(self, root: Path, source: str, snapshot_id: str | None = None, *, resume: bool = False) -> None:
        self.source = source
        self.directory = root / source / (snapshot_id or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ"))
        if (self.directory / MANIFEST_NAME).exists():
            raise SnapshotError(f"Snapshot already exists and is immutable: {self.directory}")
        if resume and not self.directory.is_dir():
            raise SnapshotError(f"Nothing to resume at {self.directory}")
        self.directory.mkdir(parents=True, exist_ok=resume)
        # A temporary file left by an interrupted write is never adopted; the file is fetched again.
        for stale in self.directory.glob(f"*{PARTIAL_SUFFIX}"):
            stale.unlink()
        self.files: dict[str, SnapshotFile] = {}
        self.created_at = datetime.now(UTC).isoformat()
        self._lock = threading.Lock()

    @staticmethod
    def _check_name(name: str) -> None:
        if "/" in name or "\\" in name or name in {"", ".", "..", MANIFEST_NAME} or name.endswith(PARTIAL_SUFFIX):
            raise SnapshotError(f"Unsafe snapshot file name: {name!r}")

    def existing(self, name: str, url: str, is_complete: Callable[[bytes], bool]) -> bytes | None:
        """On resume, adopts a file already on disk if it looks complete; otherwise returns None."""
        self._check_name(name)
        path = self.directory / name
        if not path.is_file():
            return None
        content = path.read_bytes()
        if not is_complete(content):
            return None
        fetched_at = datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()
        self._record(name, url, content, fetched_at)
        return content

    def add(self, name: str, url: str, content: bytes) -> None:
        self._check_name(name)
        # Write to a temporary name first so an interruption never leaves a truncated raw file.
        partial = self.directory / f"{name}{PARTIAL_SUFFIX}"
        partial.write_bytes(content)
        partial.replace(self.directory / name)
        self._record(name, url, content, datetime.now(UTC).isoformat())

    def _record(self, name: str, url: str, content: bytes, fetched_at: str) -> None:
        with self._lock:
            self.files[name] = SnapshotFile(
                name=name,
                url=url,
                sha256=hashlib.sha256(content).hexdigest(),
                bytes=len(content),
                fetched_at=fetched_at,
            )

    def seal(self) -> Manifest:
        unexpected = sorted(
            path.name for path in self.directory.iterdir() if path.name not in self.files and path.name != MANIFEST_NAME
        )
        if unexpected:
            raise SnapshotError(f"Files not produced by this run: {unexpected[:5]}")
        manifest = Manifest(
            source=self.source,
            created_at=self.created_at,
            sealed=True,
            files=sorted(self.files.values(), key=lambda item: item.name),
        )
        (self.directory / MANIFEST_NAME).write_text(
            json.dumps({**asdict(manifest), "checksum": manifest.checksum}, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return manifest


def read_snapshot(directory: Path) -> tuple[Manifest, dict[str, bytes]]:
    """Loads a sealed snapshot and verifies every file against its recorded SHA-256."""
    raw = json.loads((directory / MANIFEST_NAME).read_text(encoding="utf-8"))
    files = [SnapshotFile(**item) for item in raw["files"]]
    manifest = Manifest(source=raw["source"], created_at=raw["created_at"], sealed=raw["sealed"], files=files)
    if not manifest.sealed:
        raise SnapshotError(f"Snapshot is not sealed: {directory}")

    contents: dict[str, bytes] = {}
    for file in files:
        content = (directory / file.name).read_bytes()
        if hashlib.sha256(content).hexdigest() != file.sha256:
            raise SnapshotError(f"Checksum mismatch for {file.name} in {directory}")
        contents[file.name] = content
    return manifest, contents
