import { inArray } from 'drizzle-orm';

import type { Database } from '#api/db/client';
import { provinces, regions } from '#api/db/schema/index';
import { SEED_PROVINCES, SEED_REGIONS } from '@database/seeds/reference';

export async function seedReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(provinces).values([...SEED_PROVINCES]);

    const insertedProvinces = await tx
      .select({ id: provinces.id, code: provinces.code })
      .from(provinces)
      .where(
        inArray(
          provinces.code,
          SEED_PROVINCES.map((province) => province.code),
        ),
      );
    const provinceIdByCode = new Map(insertedProvinces.map(({ code, id }) => [code, id]));

    await tx.insert(regions).values(
      SEED_REGIONS.map(({ provinceCode, code, name, slug, type }) => {
        const provinceId = provinceIdByCode.get(provinceCode);
        if (provinceId === undefined) {
          throw new Error(`Seed region ${code} references unknown province ${provinceCode}.`);
        }

        return { provinceId, code, name, slug, type };
      }),
    );
  });
}
