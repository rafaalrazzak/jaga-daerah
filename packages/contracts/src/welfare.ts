import { z } from 'zod';

// BPS kabupaten/kota welfare figures. Counts and indexes stay decimal strings so a printed
// "15,58" is not turned into a false-precision integer. Empty means the book had no readable
// figure, which is not the same as zero.
const RegionCodeSchema = z.string().regex(/^\d{2}\.\d{2}$/);
const DecimalSchema = z.string().regex(/^\d+\.\d{2}$/);

const SourceSchema = z.object({
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrieved_at: z.iso.datetime({ offset: true }),
});

const SeriesSchema = z.object({
  year: z.literal(2025),
  source: SourceSchema,
  note: z.string().min(1),
});

const PovertySchema = z.object({
  people_thousands: DecimalSchema,
  percent: DecimalSchema,
  line_rupiah: z.number().int().nonnegative(),
});

const DevelopmentSchema = z.object({
  index: DecimalSchema,
  adjusted_spending_thousands: z.number().int().nonnegative(),
});

const RegionWelfareSchema = z.object({
  poverty: PovertySchema.nullable(),
  output_per_person_thousands: z.number().int().nonnegative().nullable(),
  development: DevelopmentSchema.nullable(),
});

export const WelfareFileSchema = z.object({
  poverty: SeriesSchema,
  output: SeriesSchema,
  development: SeriesSchema,
  regions: z.record(RegionCodeSchema, RegionWelfareSchema),
});

export type WelfareFile = z.infer<typeof WelfareFileSchema>;
