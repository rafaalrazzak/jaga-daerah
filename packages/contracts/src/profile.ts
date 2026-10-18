import { z } from 'zod';

import { successEnvelope } from './envelope';
import { ProvinceSchema, RegionSummarySchema, SlugSchema } from './reference';

export const YEAR_MIN = 2000;
export const YEAR_MAX = 2100;

// Rupiah as a decimal string with two places, so precision survives JSON and JavaScript.
export const RupiahSchema = z.string().regex(/^\d{1,18}\.\d{2}$/, 'Nilai rupiah tidak valid.');
// Percent with one decimal place, also as a string (computed with exact integer arithmetic).
export const PercentSchema = z.string().regex(/^\d{1,4}\.\d$/, 'Persentase tidak valid.');

export const DisasterTypeSchema = z.enum([
  'banjir',
  'cuaca_ekstrem',
  'erupsi_gunung_api',
  'gelombang_pasang_abrasi',
  'gempabumi',
  'kebakaran_hutan_lahan',
  'kekeringan',
  'tanah_longsor',
  'tsunami',
]);

// DJPK TKDD Dana Bagi Hasil lines grouped by resource (revenue sharing received, not reserves).
export const NaturalResourceTypeSchema = z.enum([
  'minyak_bumi',
  'gas_bumi',
  'minerba',
  'kehutanan',
  'perikanan',
  'panas_bumi',
  'perkebunan_sawit',
]);

// APBD expenditure by "jenis belanja": the standard classification DJPK publishes per pemda under
// the Belanja Daerah total. Ten values partition the total; DJPK's "Belanja Lainnya" subtotal is an
// aggregate of the last seven and is deliberately not a value here.
export const ExpenditureTypeSchema = z.enum([
  'belanja_pegawai',
  'belanja_barang_dan_jasa',
  'belanja_modal',
  'belanja_bunga',
  'belanja_subsidi',
  'belanja_hibah',
  'belanja_bantuan_sosial',
  'belanja_bagi_hasil',
  'belanja_bantuan_keuangan',
  'belanja_tidak_terduga',
]);

// DJPK "Realisasi Belanja Daerah menurut fungsi". Nine standard functions. "Kesehatan Tagging"
// and "Pendidikan Tagging" are folded into kesehatan and pendidikan before storage.
export const ExpenditureFunctionSchema = z.enum([
  'pelayanan_umum',
  'ketertiban_dan_keamanan',
  'ekonomi',
  'perlindungan_lingkungan_hidup',
  'perumahan_dan_fasilitas_umum',
  'kesehatan',
  'pariwisata',
  'pendidikan',
  'perlindungan_sosial',
]);

export const DataStatusSchema = z.enum(['complete', 'partial', 'unavailable']);
export const MedianComparisonSchema = z.enum(['above', 'below', 'equal']);

export const ProfileParamsSchema = z.strictObject({
  slug: SlugSchema.max(120, 'slug terlalu panjang.'),
});

export const ProfileQuerySchema = z.strictObject({
  year: z.coerce
    .number({ error: 'year harus berupa angka.' })
    .int('year harus bilangan bulat.')
    .min(YEAR_MIN, `year minimal ${YEAR_MIN}.`)
    .max(YEAR_MAX, `year maksimal ${YEAR_MAX}.`)
    .optional(),
});

export const BudgetModuleSchema = z.object({
  status: DataStatusSchema,
  // NULL = not reported by the source ("Data belum tersedia"); never coerced to zero.
  budget_amount: RupiahSchema.nullable(),
  realization_amount: RupiahSchema.nullable(),
  // NULL when either amount is missing or the budget is zero ("data tidak cukup").
  realization_percent: PercentSchema.nullable(),
  national_median_percent: PercentSchema.nullable(),
  median_comparison: MedianComparisonSchema.nullable(),
  narrative: z.array(z.string().min(1)),
});

export const DisasterTypeRowSchema = z.object({
  type: DisasterTypeSchema,
  label: z.string().min(1),
  event_count: z.number().int().nonnegative().nullable(),
  deaths: z.number().int().nonnegative().nullable(),
  missing: z.number().int().nonnegative().nullable(),
  affected: z.number().int().nonnegative().nullable(),
});

export const DisasterModuleSchema = z.object({
  level: z.literal('provinsi'),
  province: ProvinceSchema,
  status: DataStatusSchema,
  totals: z.object({
    event_count: z.number().int().nonnegative().nullable(),
    deaths: z.number().int().nonnegative().nullable(),
    missing: z.number().int().nonnegative().nullable(),
    affected: z.number().int().nonnegative().nullable(),
  }),
  by_type: z.array(DisasterTypeRowSchema),
  notes: z.array(z.string().min(1)),
});

export const NaturalResourceRowSchema = z.object({
  type: NaturalResourceTypeSchema,
  label: z.string().min(1),
  budget_amount: RupiahSchema.nullable(),
  realization_amount: RupiahSchema.nullable(),
});

export const NaturalResourceModuleSchema = z.object({
  status: DataStatusSchema,
  // NULL when there are no rows or any row has a blank amount (never a silent partial sum).
  total_budget_amount: RupiahSchema.nullable(),
  total_realization_amount: RupiahSchema.nullable(),
  by_type: z.array(NaturalResourceRowSchema),
  narrative: z.array(z.string().min(1)),
});

export const ExpenditureRowSchema = z.object({
  type: ExpenditureTypeSchema,
  label: z.string().min(1),
  // NULL = the source did not report a value ("Data belum tersedia"); never coerced to zero.
  budget_amount: RupiahSchema.nullable(),
  realization_amount: RupiahSchema.nullable(),
  // Share of the published Belanja Daerah total, one decimal. NULL when either side is unknown or
  // the total is zero ("data tidak cukup"), like the budget module.
  budget_share_percent: PercentSchema.nullable(),
  realization_share_percent: PercentSchema.nullable(),
});

export const ExpenditureBreakdownModuleSchema = z.object({
  status: DataStatusSchema,
  // The jenis rows partition the published Belanja Daerah total; both sides travel together so a
  // reader can see the reconciliation instead of trusting a single figure.
  total_budget_amount: RupiahSchema.nullable(),
  total_realization_amount: RupiahSchema.nullable(),
  by_type: z.array(ExpenditureRowSchema),
  narrative: z.array(z.string().min(1)),
});

export const ExpenditureFunctionRowSchema = z.object({
  type: ExpenditureFunctionSchema,
  label: z.string().min(1),
  // NULL = the workbook has no pagu for this vintage. Realisation-only files stay NULL, never 0.
  budget_amount: RupiahSchema.nullable(),
  realization_amount: RupiahSchema.nullable(),
  budget_share_percent: PercentSchema.nullable(),
  realization_share_percent: PercentSchema.nullable(),
});

export const ExpenditureFunctionModuleSchema = z.object({
  year: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
  status: DataStatusSchema,
  total_budget_amount: RupiahSchema.nullable(),
  total_realization_amount: RupiahSchema.nullable(),
  by_function: z.array(ExpenditureFunctionRowSchema),
  narrative: z.array(z.string().min(1)),
});

export const SourceSchema = z.object({
  publisher: z.string().min(1),
  title: z.string().min(1),
  source_url: z.url(),
  period: z.string().min(1),
  downloaded_at: z.iso.datetime({ offset: true }),
});

export const RegionProfileResponseSchema = successEnvelope(
  z.object({
    region: RegionSummarySchema,
    year: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
    available_years: z.array(z.number().int().min(YEAR_MIN).max(YEAR_MAX)),
    budget: BudgetModuleSchema,
    expenditure_breakdown: ExpenditureBreakdownModuleSchema,
    expenditure_by_function: ExpenditureFunctionModuleSchema,
    natural_resources: NaturalResourceModuleSchema,
    disaster: DisasterModuleSchema,
    sources: z.array(SourceSchema),
    published_at: z.iso.datetime({ offset: true }),
  }),
);

export const MetaStatusResponseSchema = successEnvelope(
  z.object({
    dataset_version: z.string().min(1).nullable(),
    published_at: z.iso.datetime({ offset: true }).nullable(),
    years: z.array(z.number().int().min(YEAR_MIN).max(YEAR_MAX)),
    coverage: z.object({
      provinces: z.number().int().nonnegative(),
      regions: z.number().int().nonnegative(),
      regions_with_budget: z.number().int().nonnegative(),
    }),
    sources: z.array(SourceSchema),
  }),
);

export type DisasterType = z.infer<typeof DisasterTypeSchema>;
export type DataStatus = z.infer<typeof DataStatusSchema>;
export type ExpenditureType = z.infer<typeof ExpenditureTypeSchema>;
export type ExpenditureFunction = z.infer<typeof ExpenditureFunctionSchema>;
export type ExpenditureRow = z.infer<typeof ExpenditureRowSchema>;
export type ExpenditureFunctionRow = z.infer<typeof ExpenditureFunctionRowSchema>;
export type ExpenditureBreakdownModule = z.infer<typeof ExpenditureBreakdownModuleSchema>;
export type ExpenditureFunctionModule = z.infer<typeof ExpenditureFunctionModuleSchema>;
export type NaturalResourceType = z.infer<typeof NaturalResourceTypeSchema>;
export type NaturalResourceModule = z.infer<typeof NaturalResourceModuleSchema>;
export type NaturalResourceRow = z.infer<typeof NaturalResourceRowSchema>;
export type MedianComparison = z.infer<typeof MedianComparisonSchema>;
export type BudgetModule = z.infer<typeof BudgetModuleSchema>;
export type DisasterModule = z.infer<typeof DisasterModuleSchema>;
export type DisasterTypeRow = z.infer<typeof DisasterTypeRowSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type RegionProfileResponse = z.infer<typeof RegionProfileResponseSchema>;
export type RegionProfile = RegionProfileResponse['data'];
export type MetaStatusResponse = z.infer<typeof MetaStatusResponseSchema>;
export type MetaStatus = MetaStatusResponse['data'];

export const MapRealizationQuerySchema = ProfileQuerySchema;

export const MapRealizationItemSchema = z.object({
  code: z.string().regex(/^[0-9]{2}\.[0-9]{2}$/),
  realization_percent: PercentSchema.nullable(),
  median_comparison: MedianComparisonSchema.nullable(),
});

export const MapRealizationResponseSchema = successEnvelope(
  z.object({
    year: z.number().int().min(YEAR_MIN).max(YEAR_MAX),
    available_years: z.array(z.number().int().min(YEAR_MIN).max(YEAR_MAX)),
    national_median_percent: PercentSchema.nullable(),
    items: z.array(MapRealizationItemSchema),
  }),
);

export type MapRealizationItem = z.infer<typeof MapRealizationItemSchema>;
export type MapRealizationResponse = z.infer<typeof MapRealizationResponseSchema>;
export type MapRealization = MapRealizationResponse['data'];
