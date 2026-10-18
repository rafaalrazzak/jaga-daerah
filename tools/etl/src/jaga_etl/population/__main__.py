"""Attach the checked Dukcapil population table to the published local-services file.

    uv run python -m jaga_etl.population --sql data/raw/population/wilayah_penduduk.sql \
        --services ../../apps/web/src/data/local-services.json
"""

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from jaga_etl.population.parse import NATIONAL_TOTAL, NOTE, parse_rows, require_regions
from jaga_etl.web_data import write_json

ETL_ROOT = Path(__file__).resolve().parents[3]


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Publish Dukcapil kabupaten/kota population.")
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--services", type=Path, required=True)
    parser.add_argument(
        "--regions",
        type=Path,
        default=ETL_ROOT.parents[1] / "apps" / "web" / "src" / "data" / "regions.json",
    )
    args = parser.parse_args(argv)
    regions = json.loads(args.regions.read_text(encoding="utf-8"))
    raw = args.sql.read_bytes()
    text = raw.decode("utf-8")
    checked = require_regions(parse_rows(text), regions)
    payload = json.loads(args.services.read_text(encoding="utf-8"))
    payload.pop("population_note", None)
    payload["population"] = {
        "source": {
            "publisher": "Ditjen Dukcapil, Kementerian Dalam Negeri",
            "title": "Data Kependudukan Semester II Tahun 2024 (31 Desember 2024)",
            "url": "https://github.com/cahyadsn/wilayah/blob/master/db/wilayah_penduduk.sql",
            "sha256": hashlib.sha256(raw).hexdigest(),
            "retrieved_at": datetime.now(UTC).isoformat(),
        },
        "as_of": "2024-12-31",
        "national_total": NATIONAL_TOTAL,
        "note": NOTE,
    }
    existing = payload["regions"]
    payload["regions"] = {}
    for region in regions:
        code = str(region["code"])
        record = existing.get(code, {"hospitals": None, "schools": None})
        row = checked[code]
        record["population"] = {"total": row.total, "male": row.male, "female": row.female}
        payload["regions"][code] = record
    write_json(args.services, payload)
    print(json.dumps({"regions": len(checked), "national_total": NATIONAL_TOTAL}))


if __name__ == "__main__":
    main()
