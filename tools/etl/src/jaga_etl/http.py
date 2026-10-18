"""Polite HTTP fetching for public government portals.

Thread-safe: request *starts* are spaced by `delay_seconds` across all threads, so a few concurrent
workers overlap slow responses without raising the request rate above 1 / delay_seconds. Bounded
retries on transient upstream errors, a response-size cap, and an identifying User-Agent. Never
used at application runtime.
"""

import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

USER_AGENT = "JagaDaerah-ETL/0.1 (public budget and disaster data transparency project)"
TRANSIENT_STATUS = frozenset({429, 500, 502, 503, 504, 520, 521, 522, 523, 524})


class FetchError(Exception):
    pass


@dataclass
class PoliteFetcher:
    delay_seconds: float = 1.0
    timeout_seconds: float = 60.0
    max_attempts: int = 3
    max_bytes: int = 5 * 1024 * 1024
    _last_request_at: float = field(default=0.0, init=False, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)

    def get(self, url: str) -> bytes:
        return self._fetch(url, None)

    def post_form(self, url: str, form: dict[str, str]) -> bytes:
        """URL-encoded form POST, for portals whose public listings are served only that way."""
        return self._fetch(url, urllib.parse.urlencode(form).encode())

    def _fetch(self, url: str, body: bytes | None) -> bytes:
        for attempt in range(1, self.max_attempts + 1):
            self._wait_turn()
            request = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    content = response.read(self.max_bytes + 1)
            except urllib.error.HTTPError as error:
                if error.code in TRANSIENT_STATUS and attempt < self.max_attempts:
                    time.sleep(self._backoff(error, attempt))
                    continue
                raise FetchError(f"HTTP {error.code} for {url}") from error
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                if attempt < self.max_attempts:
                    time.sleep(self.delay_seconds * 2**attempt)
                    continue
                raise FetchError(f"Network error for {url}: {error}") from error

            if len(content) > self.max_bytes:
                raise FetchError(f"Response exceeds {self.max_bytes} bytes: {url}")
            return content
        raise FetchError(f"Gave up after {self.max_attempts} attempts: {url}")

    def _backoff(self, error: urllib.error.HTTPError, attempt: int) -> float:
        """Honour Retry-After (seconds, capped at two minutes); otherwise back off exponentially."""
        retry_after = error.headers.get("Retry-After", "") if error.headers else ""
        if retry_after.isdigit():
            return min(float(retry_after), 120.0)
        return self.delay_seconds * 2**attempt

    def _wait_turn(self) -> None:
        with self._lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < self.delay_seconds:
                time.sleep(self.delay_seconds - elapsed)
            self._last_request_at = time.monotonic()
