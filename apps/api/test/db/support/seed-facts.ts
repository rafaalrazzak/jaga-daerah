import { eq } from 'drizzle-orm';

import type { Database } from '#api/db/client';
import {
  budgetFacts,
  dataNotes,
  dataSources,
  datasetVersions,
  disasterFacts,
  expenditureBreakdownFacts,
  naturalResourceRevenueFacts,
  provinces,
  regions,
} from '#api/db/schema/index';

export const FACTS_VERSION = 'test-facts-v1';
export const ALL_DISASTER_TYPES = [
  'banjir',
  'cuaca_ekstrem',
  'erupsi_gunung_api',
  'gelombang_pasang_abrasi',
  'gempabumi',
  'kebakaran_hutan_lahan',
  'kekeringan',
  'tanah_longsor',
  'tsunami',
] as const;

/**
 * Published facts covering complete, partial, and missing cases:
 * - 32.73 Kota Bandung 2025: complete budget (89.8%), Jawa Barat disaster data complete.
 * - 32.04 Kabupaten Bandung 2025: budget with realisation missing (partial).
 * - 32.17 Kabupaten Bandung Barat 2025: complete budget (95.0%).
 * - 11.71 Kota Banda Aceh: budget only for 2024; Aceh disaster data 2025 partial.
 */
export async function seedPublishedFacts(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const [version] = await tx
      .insert(datasetVersions)
      .values({
        version: FACTS_VERSION,
        status: 'active',
        publishedAt: new Date('2026-10-17T08:32:12Z'),
      })
      .returning({ id: datasetVersions.id });
    if (version === undefined) throw new Error('version insert failed');

    const [djpk, bnpb] = await tx
      .insert(dataSources)
      .values([
        {
          datasetVersionId: version.id,
          publisher: 'DJPK Kemenkeu',
          title: 'Portal Data SIKD',
          sourceUrl: 'https://djpk.kemenkeu.go.id/portal/data/apbd',
          period: '2024,2025',
          downloadedAt: new Date('2026-10-17T07:07:47Z'),
          checksumSha256: 'a'.repeat(64),
        },
        {
          datasetVersionId: version.id,
          publisher: 'BNPB',
          title: 'Kompilasi Data Kejadian dan Dampak Bencana',
          sourceUrl: 'https://data.bnpb.go.id',
          period: '2024,2025',
          downloadedAt: new Date('2026-10-17T07:07:40Z'),
          checksumSha256: 'b'.repeat(64),
        },
      ])
      .returning({ id: dataSources.id });
    if (djpk === undefined || bnpb === undefined) throw new Error('source insert failed');

    const regionId = async (code: string) => {
      const [row] = await tx.select({ id: regions.id }).from(regions).where(eq(regions.code, code));
      if (row === undefined) throw new Error(`missing region ${code}`);
      return row.id;
    };
    const provinceId = async (code: string) => {
      const [row] = await tx
        .select({ id: provinces.id })
        .from(provinces)
        .where(eq(provinces.code, code));
      if (row === undefined) throw new Error(`missing province ${code}`);
      return row.id;
    };

    const budget = async (
      code: string,
      year: number,
      amount: string | null,
      realization: string | null,
    ) =>
      tx.insert(budgetFacts).values({
        datasetVersionId: version.id,
        regionId: await regionId(code),
        year,
        budgetAmount: amount,
        realizationAmount: realization,
        sourceId: djpk.id,
      });
    await budget('32.73', 2025, '8345231335444.90', '7490617461211.10');
    await budget('32.04', 2025, '1000.00', null);
    await budget('32.17', 2025, '2000.00', '1900.00');
    await budget('11.71', 2024, '1317952493749.00', '1342398868864.30');

    const bandungCity = await regionId('32.73');
    const bandungRegency = await regionId('32.04');
    await tx.insert(expenditureBreakdownFacts).values(
      [
        // Kota Bandung 2025: the real published jenis split. The printed figures sum to Rp0.03
        // more than the published Belanja Daerah total, which is exactly the source rounding the
        // ETL gate must tolerate rather than reject.
        ['32.73' as const, 'belanja_pegawai', '2884410615525.00', '2739791512799.00'],
        ['32.73' as const, 'belanja_barang_dan_jasa', '3961088112461.60', '3451980612625.10'],
        ['32.73' as const, 'belanja_modal', '1016746332144.70', '916847678592.00'],
        ['32.73' as const, 'belanja_hibah', '350833470000.00', '339497718658.00'],
        ['32.73' as const, 'belanja_bantuan_sosial', '43853360000.00', '41530230000.00'],
        ['32.73' as const, 'belanja_tidak_terduga', '88299445313.63', '969708537.00'],
        // Kabupaten Bandung 2025: one jenis realization blank in the source, so the breakdown is
        // partial and must stay that way rather than reporting a partial sum as a total.
        ['32.04' as const, 'belanja_pegawai', '600.00', '0.00'],
        ['32.04' as const, 'belanja_barang_dan_jasa', '400.00', null],
      ].map(([code, expenditureType, budgetAmount, realizationAmount]) => ({
        datasetVersionId: version.id,
        regionId: code === '32.73' ? bandungCity : bandungRegency,
        year: 2025,
        expenditureType: expenditureType as 'belanja_pegawai',
        budgetAmount,
        realizationAmount,
        sourceId: djpk.id,
      })),
    );

    await tx.insert(naturalResourceRevenueFacts).values(
      [
        ['panas_bumi', '1200100000000.00', '1150500000000.00'],
        ['gas_bumi', '3250000000.00', null],
        ['minyak_bumi', '12500000000.00', '12500000000.00'],
      ].map(([resourceType, budgetAmount, realizationAmount]) => ({
        datasetVersionId: version.id,
        regionId: bandungCity,
        year: 2025,
        resourceType: resourceType as 'panas_bumi' | 'gas_bumi' | 'minyak_bumi',
        budgetAmount,
        realizationAmount,
        sourceId: djpk.id,
      })),
    );

    const jawaBarat = await provinceId('32');
    const aceh = await provinceId('11');
    await tx.insert(disasterFacts).values([
      ...ALL_DISASTER_TYPES.map((disasterType, index) => ({
        datasetVersionId: version.id,
        provinceId: jawaBarat,
        year: 2025,
        disasterType,
        eventCount: index * 10,
        deaths: index,
        missing: 0,
        affected: index * 1000,
        sourceId: bnpb.id,
      })),
      ...(['banjir', 'gempabumi', 'tsunami'] as const).map((disasterType) => ({
        datasetVersionId: version.id,
        provinceId: aceh,
        year: 2025,
        disasterType,
        eventCount: disasterType === 'tsunami' ? null : 4,
        deaths: 0,
        missing: 0,
        affected: 10,
        sourceId: bnpb.id,
      })),
    ]);

    await tx.insert(dataNotes).values({
      datasetVersionId: version.id,
      year: 2025,
      disasterType: 'gempabumi',
      metric: 'event_count',
      note: 'Jumlah kejadian gempabumi tahun 2025: jumlah seluruh provinsi di data BNPB (29) berbeda dengan total nasional BNPB (28). Angka provinsi ditampilkan sesuai sumber.',
    });
  });
}
