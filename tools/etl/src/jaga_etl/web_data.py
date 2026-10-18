"""Write committed JSON artifacts consumed by the web app.

Oxfmt owns the formatting of everything under `apps/web`, so these writers must emit what it accepts —
otherwise `bun run format:check` fails on generated files that nobody hand-edits. `Path.write_text`
also translates "\\n" to CRLF on Windows, so files are opened with `newline="\\n"` explicitly.
"""

import json
from pathlib import Path
from typing import Any

# Matches .oxfmtrc.json: tabWidth 2, endOfLine lf, insertFinalNewline.
INDENT = 2


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    """Write `payload` as JSON with LF endings and a final newline.

    `compact` keeps the payload on one line, for files served to browsers where the bytes are the
    cost (the map outlines); everything else is indented for reviewable diffs.
    """
    text = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if compact
        else json.dumps(payload, ensure_ascii=False, indent=INDENT)
    )  # fmt: skip
    with path.open("w", encoding="utf-8", newline="\n") as file:
        file.write(text + "\n")
