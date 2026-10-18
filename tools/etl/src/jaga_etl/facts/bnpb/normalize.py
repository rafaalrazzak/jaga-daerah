"""Turn BNPB datastore responses into per-province, per-type disaster records."""

import json
import re
from decimal import Decimal
from dataclasses import dataclass, field

from jaga_etl.facts.bnpb.source import (
    DISASTER_COLUMNS,
    NATIONAL_TOTAL_LABEL,
    RESOURCES,
    BnpbResource,
    Metric,
    resource_file_name,
)

METRICS: tuple[Metric, ...] = ("event_count", "deaths", "missing", "affected")
WHOLE_NUMBER_TEXT = re.compile(r"\d+(?:\.0+)?")


@dataclass(frozen=True)
class DisasterRecord:
    province_code: str
    year: int
    disaster_type: str
    event_count: int | None
    deaths: int | None
    missing: int | None
    affected: int | None


@dataclass
class BnpbResult:
    records: list[DisasterRecord]
    # (year, metric, disaster_type) → national total reported by BNPB, for aggregate checks.
    national_totals: dict[tuple[int, str, str], int]
    rejections: list[str] = field(default_factory=list)
    rows_read: int = 0


def _count(value: object) -> int | None:
    """Blank stays None (not reported); numbers must be non-negative integers."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"unexpected boolean {value!r}")
    if isinstance(value, int):
        number = value
    elif isinstance(value, float) and value.is_integer():
        number = int(value)
    elif isinstance(value, str) and WHOLE_NUMBER_TEXT.fullmatch(value.strip()):
        # The datastore returns some cells as text such as "0.0".
        number = int(Decimal(value.strip()))
    else:
        raise ValueError(f"not a whole number: {value!r}")
    if number < 0:
        raise ValueError(f"negative count: {number}")
    return number


def _province_code(value: object) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"invalid province code {value!r}")
    code = str(value).strip()
    if not code.isdigit() or not 11 <= int(code) <= 99:
        raise ValueError(f"invalid province code {value!r}")
    return f"{int(code):02d}"


def _records(content: bytes) -> list[dict[str, object]]:
    payload = json.loads(content)
    if not payload.get("success"):
        raise ValueError("datastore response is not successful")
    result = payload["result"]
    records = result["records"]
    if result.get("total", len(records)) != len(records):
        raise ValueError(f"datastore returned {len(records)} of {result.get('total')} rows; paging required")
    return records


def normalize(contents: dict[str, bytes], resources: tuple[BnpbResource, ...] = RESOURCES) -> BnpbResult:
    values: dict[tuple[str, int, str], dict[str, int | None]] = {}
    result = BnpbResult(records=[], national_totals={})

    for resource in resources:
        name = resource_file_name(resource)
        if name not in contents:
            result.rejections.append(f"missing snapshot file {name}")
            continue
        for row in _records(contents[name]):
            result.rows_read += 1
            label = str(row.get("Provinsi", "")).strip().upper()
            missing_columns = [column for column in DISASTER_COLUMNS if column not in row]
            if missing_columns:
                result.rejections.append(f"{name}: row {label!r} lacks columns {missing_columns}")
                continue
            try:
                if label == NATIONAL_TOTAL_LABEL:
                    for column, disaster_type in DISASTER_COLUMNS.items():
                        total = _count(row[column])
                        if total is not None:
                            result.national_totals[(resource.year, resource.metric, disaster_type)] = total
                    continue
                code = _province_code(row.get("Kode Wilayah Provinsi"))
                for column, disaster_type in DISASTER_COLUMNS.items():
                    key = (code, resource.year, disaster_type)
                    metrics = values.setdefault(key, {})
                    if resource.metric in metrics:
                        raise ValueError(f"duplicate {resource.metric} for province {code}")
                    metrics[resource.metric] = _count(row[column])
            except ValueError as error:
                result.rejections.append(f"{name}: row {label!r}: {error}")

    for (code, year, disaster_type), metrics in sorted(values.items()):
        result.records.append(
            DisasterRecord(
                province_code=code,
                year=year,
                disaster_type=disaster_type,
                event_count=metrics.get("event_count"),
                deaths=metrics.get("deaths"),
                missing=metrics.get("missing"),
                affected=metrics.get("affected"),
            )
        )
    return result
