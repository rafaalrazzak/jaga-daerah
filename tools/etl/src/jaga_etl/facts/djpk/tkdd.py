"""Natural-resource revenue sharing from the DJPK TKDD export.

The export lists Transfer ke Daerah accounts as flat rows (Akun / Anggaran / Realisasi / Persentase)
with amounts printed as text in miliar rupiah with two decimals, e.g. "4.580,69 M". Only the
Dana Bagi Hasil Sumber Daya Alam lines and DBH Perkebunan Sawit are kept, grouped by resource.

These figures are what a region RECEIVES under the revenue-sharing formula; regions that produce
nothing can still receive a share from their province, so they do not measure resource wealth.
"""

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

MILIAR = Decimal(1_000_000_000)
CENTS = Decimal("0.01")
AMOUNT = re.compile(r"^(?P<number>\d{1,3}(?:\.\d{3})*,\d{2}) M$")

# Ordered: the first matching pattern wins.
RESOURCE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^DBH SDA Minyak Bumi\b", re.IGNORECASE), "minyak_bumi"),
    (re.compile(r"^DBH SDA Gas Bumi\b", re.IGNORECASE), "gas_bumi"),
    (re.compile(r"^DBH SDA Minerba\b", re.IGNORECASE), "minerba"),
    (re.compile(r"^DBH SDA Kehutanan\b", re.IGNORECASE), "kehutanan"),
    (re.compile(r"^DBH SDA Perikanan\b", re.IGNORECASE), "perikanan"),
    (re.compile(r"^DBH SDA\b.*\bPanas Bumi\b", re.IGNORECASE), "panas_bumi"),
    (re.compile(r"^Dana Bagi Hasil Perkebunan Sawit$", re.IGNORECASE), "perkebunan_sawit"),
)
# Anything that looks like a resource line but matches no pattern blocks publication for review.
RESOURCE_LIKE = re.compile(r"^DBH SDA\b|\bSawit\b", re.IGNORECASE)


@dataclass(frozen=True)
class ResourceAmount:
    resource_type: str
    budget_amount: Decimal | None
    realization_amount: Decimal | None
    lines: int


def parse_miliar(text: str) -> Decimal | None:
    """ "4.580,69 M" → Decimal("4580690000000.00"); blank → None."""
    stripped = text.strip()
    if stripped == "":
        return None
    match = AMOUNT.fullmatch(stripped)
    if match is None:
        raise ValueError(f"unexpected TKDD amount {text!r}")
    try:
        value = Decimal(match.group("number").replace(".", "").replace(",", "."))
    except InvalidOperation as error:
        raise ValueError(f"unexpected TKDD amount {text!r}") from error
    return (value * MILIAR).quantize(CENTS)


def classify(account: str) -> str | None:
    for pattern, resource_type in RESOURCE_PATTERNS:
        if pattern.search(account):
            return resource_type
    if RESOURCE_LIKE.search(account):
        raise ValueError(f"unrecognised resource line {account!r}")
    return None


def _add(left: Decimal | None, right: Decimal | None) -> Decimal | None:
    # Any blank line makes the group total unknown, never a silent partial sum.
    return None if left is None or right is None else left + right


def resource_amounts(rows: list[list[str]]) -> list[ResourceAmount]:
    header = rows[0] if rows else []
    if header[:3] != ["Akun", "Anggaran", "Realisasi"]:
        raise ValueError(f"unexpected TKDD header {header!r}")

    seen: set[str] = set()
    grouped: dict[str, ResourceAmount] = {}
    for row in rows[1:]:
        if not row or row[0] == "":
            continue
        account = row[0]
        resource_type = classify(account)
        if resource_type is None:
            continue
        if account in seen:
            raise ValueError(f"duplicate resource line {account!r}")
        seen.add(account)
        budget = parse_miliar(row[1] if len(row) > 1 else "")
        realization = parse_miliar(row[2] if len(row) > 2 else "")
        previous = grouped.get(resource_type)
        grouped[resource_type] = (
            ResourceAmount(resource_type, budget, realization, 1)
            if previous is None
            else ResourceAmount(
                resource_type,
                _add(previous.budget_amount, budget),
                _add(previous.realization_amount, realization),
                previous.lines + 1,
            )
        )
    return [grouped[key] for key in sorted(grouped)]
