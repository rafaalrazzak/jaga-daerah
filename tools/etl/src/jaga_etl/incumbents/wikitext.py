"""Parse Wikipedia "List of incumbent regional heads and deputy regional heads in <province>" tables.

Each row describes one regency/city: its link, then for the head and the deputy a photo file, a
party colour (in the cell's style attribute) and a name, then the dates of office. Rows vary
(acting officers, vacant deputies, merged cells), so cells are classified by content.

Dates come in two shapes. Normally "Taking Office" and "End of Office" are separate cells and are read
positionally. Jakarta's administrative rows instead put both offices' dates in one merged cell with an
inline label ("Mayor : 7 May 2025 <br> Deputy Mayor : 17 December 2025"); there the head's date is the
only start known and the term is open (`until: null`), because that page writes the shared end-of-office
cell as prose with no date. A cell holding two dates and no label is rejected rather than guessed.
"""

import re
from dataclasses import dataclass

LINK = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
FILE = re.compile(r"\[\[(?:File|Berkas|Image):([^\]|]+)", re.IGNORECASE)
PARTY = re.compile(r"\{\{\s*party colou?r\s*\|\s*([^}|]+)", re.IGNORECASE)
DATE = re.compile(
    r"\b(\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4})\b"
)
ACTING = re.compile(r"\b(acting|plt|pj|caretaker)\b", re.IGNORECASE)
REF = re.compile(r"<ref[^>]*/>|<ref[^>]*>.*?</ref>", re.DOTALL)
TEMPLATE = re.compile(r"\{\{(?:center|small|nowrap)\|", re.IGNORECASE)
NOT_A_NAME = ("list", "vacant", "kosong", "&nbsp;", "-", "—")
# A merged office cell labels each date ("Mayor : 7 May 2025 <br> Deputy Mayor : 17 December 2025").
DEPUTY_LABEL = re.compile(r"\b(?:deputy|wakil|vice)\b[^:]{0,20}:", re.IGNORECASE)
HEAD_LABEL = re.compile(r"\b(?:mayor|regent|bupati|wali\s*kota)\b\s*:", re.IGNORECASE)


@dataclass(frozen=True)
class WikiPerson:
    name: str
    party: str | None
    photo_file: str | None
    acting: bool


@dataclass(frozen=True)
class WikiRow:
    region: str
    # Link target ("Bone Regency"); preferred over the display text, which editors sometimes mistype.
    region_target: str
    head: WikiPerson | None
    deputy: WikiPerson | None
    since: str | None
    until: str | None


def _strip_attributes(cell: str) -> str:
    """`align="center" | text` → `text`, ignoring pipes inside [[...]] and {{...}}."""
    depth = 0
    for index, char in enumerate(cell):
        if char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
        elif char == "|" and depth == 0:
            prefix = cell[:index]
            if "=" in prefix or prefix.strip() == "":
                return cell[index + 1 :].strip()
            break
    return cell.strip()


def _cells(row: str) -> list[tuple[str, str]]:
    """(raw, content) per cell. The party colour sits in the raw attribute part, so keep both."""
    cells: list[tuple[str, str]] = []
    for line in row.split("\n"):
        if line.startswith(("|}", "|-")):
            continue  # table end / row separator
        if line.startswith("|"):
            for part in line[1:].split("||"):
                cells.append((part, _strip_attributes(part)))
        elif cells and line and not line.startswith("!"):
            raw, content = cells[-1]
            cells[-1] = (f"{raw}\n{line}", f"{content}\n{line}")
    return cells


def _clean(text: str) -> str:
    text = REF.sub("", text)
    text = TEMPLATE.sub("", text).replace("}}", "")
    text = LINK.sub(lambda match: match.group(2) or match.group(1), text)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>|''+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _person_name(cell: str) -> tuple[str, bool] | None:
    without_refs = REF.sub("", cell)
    if FILE.search(without_refs) or DATE.search(without_refs):
        return None
    first_link = LINK.search(without_refs)
    name = _clean(first_link.group(2) or first_link.group(1)) if first_link else _clean(without_refs)
    name = re.sub(r"\s*\((?:[^)]*politician[^)]*)\)$", "", name).strip()
    if not name or name.lower().startswith(NOT_A_NAME):
        return None
    return name, bool(ACTING.search(without_refs))


def _office_dates(cell: str) -> tuple[str | None, str | None] | None:
    """Read a merged cell that labels each office ("Mayor : 7 May 2025 <br> Deputy Mayor : 17 December 2025").

    Returns (head start, deputy start) when the cell labels at least the head date, else None. Without
    the labels the dates would be positional, which is what corrupts Jakarta's administrative rows.
    """
    if not HEAD_LABEL.search(cell) and not DEPUTY_LABEL.search(cell):
        return None
    deputy = DEPUTY_LABEL.search(cell)
    head = HEAD_LABEL.search(cell)
    head_text = cell[head.end() : (deputy.start() if deputy and deputy.start() > head.end() else len(cell))] if head else ""
    deputy_text = cell[deputy.end() :] if deputy else ""
    head_dates = DATE.findall(head_text)
    deputy_dates = DATE.findall(deputy_text)
    if not head_dates and not deputy_dates:
        return None
    return (head_dates[0] if head_dates else None, deputy_dates[0] if deputy_dates else None)


def parse_row(row: str) -> WikiRow | None:
    cells = [(raw, content) for raw, content in _cells(row) if raw.strip() != ""]
    if not cells:
        return None
    region_links = [
        match
        for match in LINK.finditer(REF.sub("", cells[0][1]))
        if not match.group(1).lower().startswith(("file:", "berkas:", "image:"))
    ]
    if not region_links:
        return None
    region = _clean(region_links[0].group(2) or region_links[0].group(1))
    region_target = _clean(region_links[0].group(1))

    photos: list[str] = []
    parties: list[str] = []
    people: list[tuple[str, bool]] = []
    dates: list[str] = []
    merged: tuple[str | None, str | None] | None = None
    for raw, content in cells[1:]:
        if party := PARTY.search(raw):
            parties.append(party.group(1).strip())
            continue
        cleaned = REF.sub("", content)
        if cleaned.strip() == "":
            continue
        if file := FILE.search(content):
            photos.append(file.group(1).strip())
            continue
        if (labelled := _office_dates(cleaned)) is not None:
            merged = labelled
            continue
        if found := DATE.findall(cleaned):
            if len(found) > 1:
                # Two dates in one cell with no "Mayor : … / Deputy Mayor : …" label cannot be
                # assigned by position; failing loudly beats re-creating the Jakarta corruption.
                raise ValueError(f"unlabelled merged date cell in {region!r}: {cleaned.strip()!r}")
            dates.extend(found)
            continue
        if len(people) < 2 and (person := _person_name(content)) is not None:
            people.append(person)

    def person(index: int) -> WikiPerson | None:
        if index >= len(people):
            return None
        name, acting = people[index]
        return WikiPerson(
            name=name,
            party=parties[index] if index < len(parties) else None,
            photo_file=photos[index] if index < len(photos) else None,
            acting=acting,
        )

    # A merged cell labels each office's date, so only the head's start is known and the term is open;
    # two separate date cells are the "Taking Office"/"End of Office" columns, read positionally.
    if merged is not None:
        since, until = merged[0], None
    else:
        since, until = (dates[0] if dates else None), (dates[1] if len(dates) > 1 else None)
    return WikiRow(region, region_target, person(0), person(1), since, until)


def table_rows(wikitext: str) -> list[str]:
    """Body rows of every wikitable on the page (header rows start with '!')."""
    rows: list[str] = []
    for table in re.findall(r"\{\|.*?\n\|\}", wikitext, re.DOTALL):
        for row in table.split("\n|-")[1:]:
            if row.lstrip("-\n ").startswith("!"):
                continue
            rows.append(row)
    return rows
