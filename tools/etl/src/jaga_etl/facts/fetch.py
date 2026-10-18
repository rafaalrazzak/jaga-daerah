"""Download raw DJPK and BNPB responses into sealed snapshots (network access happens only here).

Requests run on a small thread pool so slow responses overlap, while `PoliteFetcher` still spaces
request starts globally. An interrupted DJPK crawl can be resumed: complete files already on disk
are adopted, everything else is fetched again.
"""

import json
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from jaga_etl.facts.bnpb.source import RESOURCES, datastore_url, resource_file_name
from jaga_etl.facts.djpk import source as djpk
from jaga_etl.facts.djpk.normalize import parse_pemda, parse_provinces
from jaga_etl.http import PoliteFetcher
from jaga_etl.snapshot import Manifest, SnapshotWriter

Progress = Callable[[str], None]
DEFAULT_WORKERS = 4


def _looks_like_json(content: bytes) -> bool:
    try:
        json.loads(content)
    except ValueError:
        return False
    return True


def _looks_like_workbook(content: bytes) -> bool:
    return content.lstrip().startswith(b"<?xml") and content.rstrip().endswith(b"</Workbook>")


def _looks_like_page(content: bytes) -> bool:
    return b"</html>" in content.lower()


class _Downloader:
    def __init__(self, writer: SnapshotWriter, fetcher: PoliteFetcher, progress: Progress) -> None:
        self.writer = writer
        self.fetcher = fetcher
        self.progress = progress

    def get(self, name: str, url: str, is_complete: Callable[[bytes], bool]) -> bytes:
        reused = self.writer.existing(name, url, is_complete)
        if reused is not None:
            return reused
        content = self.fetcher.get(url)
        if not is_complete(content):
            raise RuntimeError(f"Incomplete or unexpected response for {url}")
        self.writer.add(name, url, content)
        self.progress(name)
        return content


def fetch_bnpb(
    root: Path, fetcher: PoliteFetcher, progress: Progress = print, workers: int = DEFAULT_WORKERS
) -> tuple[Path, Manifest]:
    writer = SnapshotWriter(root, "bnpb")
    downloader = _Downloader(writer, fetcher, progress)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(
            pool.map(
                lambda resource: downloader.get(resource_file_name(resource), datastore_url(resource), _looks_like_json),
                RESOURCES,
            )
        )
    return writer.directory, writer.seal()


def fetch_djpk(
    root: Path,
    years: tuple[int, ...],
    fetcher: PoliteFetcher,
    progress: Progress = print,
    workers: int = DEFAULT_WORKERS,
    resume_snapshot: str | None = None,
) -> tuple[Path, Manifest]:
    writer = SnapshotWriter(root, "djpk", resume_snapshot, resume=resume_snapshot is not None)
    downloader = _Downloader(writer, fetcher, progress)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for year in years:
            page = downloader.get(djpk.provinces_file(year), djpk.provinces_url(year), _looks_like_page)
            provinces = sorted(parse_provinces(page.decode("utf-8", errors="replace")))
            if not provinces:
                raise RuntimeError(f"DJPK returned no provinces for {year}; page layout may have changed")

            pemda_lists = pool.map(
                lambda code: (
                    code,
                    downloader.get(djpk.pemda_file(year, code), djpk.pemda_url(code, year), _looks_like_json),
                ),
                provinces,
            )
            jobs = [
                job
                for province, content in pemda_lists
                for pemda in sorted(parse_pemda(content))
                for job in (
                    (djpk.apbd_file(year, province, pemda), djpk.apbd_url(year, province, pemda)),
                    (djpk.tkdd_file(year, province, pemda), djpk.tkdd_url(year, province, pemda)),
                )
            ]
            # Consume the iterator so any download error surfaces here.
            list(pool.map(lambda job: downloader.get(job[0], job[1], _looks_like_workbook), jobs))
    return writer.directory, writer.seal()
