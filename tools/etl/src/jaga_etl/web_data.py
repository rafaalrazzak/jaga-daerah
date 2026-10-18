"""Write committed JSON artifacts consumed by the web app.

Oxfmt owns the formatting of everything under `apps/web`, so these writers must emit what it accepts —
otherwise `bun run format:check` fails on generated files that nobody hand-edits. `Path.write_text`
also translates "\\n" to CRLF on Windows, so files are opened with `newline="\\n"` explicitly.
"""

import json
from pathlib import Path
from typing import Any

# Matches .oxfmtrc.json: tabWidth 2, printWidth 100, endOfLine lf, insertFinalNewline.
INDENT = 2
PRINT_WIDTH = 100


def _is_scalar(value: Any) -> bool:
    return not isinstance(value, (dict, list))


def _encode(value: Any, level: int, prefix: int, trailing: int) -> str:
    """Indented JSON that matches oxfmt: objects stay expanded, scalar arrays go inline when they fit.

    `prefix` is the width already on the line before `value` (`"key": `) and `trailing` the width
    after it (the separating comma), because oxfmt measures the whole line against `PRINT_WIDTH`.
    Widths are counted in code points, which equals display width for the Latin text written here.
    """
    if _is_scalar(value):
        return json.dumps(value, ensure_ascii=False)
    if not value:
        return "[]" if isinstance(value, list) else "{}"
    inner = " " * (INDENT * (level + 1))
    closing = " " * (INDENT * level)
    if isinstance(value, dict):
        items = list(value.items())
        lines = [
            f"{inner}{json.dumps(key, ensure_ascii=False)}: "
            + _encode(item, level + 1, len(json.dumps(key, ensure_ascii=False)) + 2, int(i < len(items) - 1))
            for i, (key, item) in enumerate(items)
        ]
        return "{\n" + ",\n".join(lines) + "\n" + closing + "}"
    if all(_is_scalar(item) for item in value):
        inline = "[" + ", ".join(json.dumps(item, ensure_ascii=False) for item in value) + "]"
        if INDENT * level + prefix + len(inline) + trailing <= PRINT_WIDTH:
            return inline
        if len(value) > 1 and all(isinstance(item, (int, float)) and not isinstance(item, bool) for item in value):
            # Oxfmt "fills" long number arrays several per line; emulate that before relying on it.
            raise ValueError("long all-number arrays are not supported by write_json")
    lines = [
        inner + _encode(item, level + 1, 0, int(i < len(value) - 1)) for i, item in enumerate(value)
    ]
    return "[\n" + ",\n".join(lines) + "\n" + closing + "]"


def write_json(path: Path, payload: Any, *, compact: bool = False) -> None:
    """Write `payload` as JSON with LF endings and a final newline.

    `compact` keeps the payload on one line, for files served to browsers where the bytes are the
    cost (the map outlines); everything else is indented for reviewable diffs.
    """
    text = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if compact
        else _encode(payload, 0, 0, 0)
    )  # fmt: skip
    with path.open("w", encoding="utf-8", newline="\n") as file:
        file.write(text + "\n")
