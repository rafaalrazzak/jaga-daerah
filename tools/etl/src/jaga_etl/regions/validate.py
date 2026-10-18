"""Quality gate for region reference data. Any error blocks the load entirely."""

import csv
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from jaga_etl.regions.normalize import NormalizedRegions


@dataclass(frozen=True)
class OfficialCount:
    province_code: str
    kabupaten: int
    kota: int


@dataclass(frozen=True)
class ValidationResult:
    errors: list[str]

    @property
    def is_valid(self) -> bool:
        return not self.errors


def read_official_counts(path: Path) -> dict[str, OfficialCount]:
    with path.open(encoding="utf-8", newline="") as file:
        return {
            row["province_code"]: OfficialCount(
                province_code=row["province_code"],
                kabupaten=int(row["kabupaten"]),
                kota=int(row["kota"]),
            )
            for row in csv.DictReader(file)
        }


def _duplicates(values: list[str]) -> list[str]:
    return sorted(value for value, count in Counter(values).items() if count > 1)


def validate(data: NormalizedRegions, official: dict[str, OfficialCount]) -> ValidationResult:
    errors: list[str] = []

    errors.extend(f"rejected {r.code} {r.name!r}: {r.reason}" for r in data.rejections)

    for label, values in (
        ("province code", [p.code for p in data.provinces]),
        ("province slug", [p.slug for p in data.provinces]),
        ("region code", [r.code for r in data.regions]),
        ("region slug", [r.slug for r in data.regions]),
    ):
        errors.extend(f"duplicate {label}: {value}" for value in _duplicates(values))

    errors.extend(
        f"empty slug for {item.code} {item.name!r}"
        for item in [*data.provinces, *data.regions]
        if not item.slug
    )

    province_codes = {p.code for p in data.provinces}
    errors.extend(
        f"region {r.code} references unknown province {r.province_code}"
        for r in data.regions
        if r.province_code not in province_codes
    )

    if province_codes != set(official):
        missing = sorted(set(official) - province_codes)
        unexpected = sorted(province_codes - set(official))
        errors.append(f"province set differs from official recap: missing={missing} unexpected={unexpected}")

    actual = Counter((r.province_code, r.type) for r in data.regions)
    for code, expected in sorted(official.items()):
        for region_type, expected_count in (("kabupaten", expected.kabupaten), ("kota", expected.kota)):
            actual_count = actual[(code, region_type)]
            if actual_count != expected_count:
                errors.append(
                    f"province {code}: {actual_count} {region_type} in source, "
                    f"official recap says {expected_count}"
                )

    return ValidationResult(errors=errors)
