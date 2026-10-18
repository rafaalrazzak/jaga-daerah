"""Transactional upsert of validated region reference data.

Rows are matched by official code. Codes missing from the new source are deactivated rather
than deleted, because published facts may still reference them.
"""

from dataclasses import dataclass

import psycopg

from jaga_etl.regions.normalize import NormalizedRegions


@dataclass(frozen=True)
class LoadSummary:
    provinces_upserted: int
    regions_upserted: int
    regions_deactivated: int


UPSERT_PROVINCE = """
INSERT INTO provinces (code, name, slug)
VALUES (%(code)s, %(name)s, %(slug)s)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug
"""

UPSERT_REGION = """
INSERT INTO regions (province_id, code, name, slug, type, is_active)
SELECT p.id, %(code)s, %(name)s, %(slug)s, %(type)s::region_type, true
FROM provinces p
WHERE p.code = %(province_code)s
ON CONFLICT (code) DO UPDATE SET
  province_id = EXCLUDED.province_id,
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  type = EXCLUDED.type,
  is_active = true
"""

DEACTIVATE_MISSING_REGIONS = """
UPDATE regions SET is_active = false
WHERE is_active AND NOT (code = ANY(%(codes)s))
"""


def load(connection: psycopg.Connection, data: NormalizedRegions) -> LoadSummary:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.executemany(
            UPSERT_PROVINCE,
            [{"code": p.code, "name": p.name, "slug": p.slug} for p in data.provinces],
        )
        cursor.executemany(
            UPSERT_REGION,
            [
                {
                    "code": r.code,
                    "province_code": r.province_code,
                    "name": r.name,
                    "slug": r.slug,
                    "type": r.type,
                }
                for r in data.regions
            ],
        )
        cursor.execute(DEACTIVATE_MISSING_REGIONS, {"codes": [r.code for r in data.regions]})
        deactivated = cursor.rowcount

        cursor.execute("SELECT count(*) FROM regions WHERE is_active")
        row = cursor.fetchone()
        active = row[0] if row is not None else 0
        if active != len(data.regions):
            # Raising inside the transaction block rolls everything back.
            raise RuntimeError(f"expected {len(data.regions)} active regions after load, found {active}")

    return LoadSummary(
        provinces_upserted=len(data.provinces),
        regions_upserted=len(data.regions),
        regions_deactivated=deactivated,
    )
