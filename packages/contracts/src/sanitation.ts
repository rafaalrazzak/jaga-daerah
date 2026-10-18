import { z } from 'zod';

// BPS kabupaten/kota SDG 6.2.1*. The table declares two decimal places, so "90.6" is stored as
// "90.60". A null percent is a listed region whose cell BPS left empty. Zero would mean BPS
// reported zero.
const RegionCodeSchema = z.string().regex(/^\d{2}\.\d{2}$/);
const PercentSchema = z.string().regex(/^(?:100\.00|\d{1,2}\.\d{2})$/);

const SourceSchema = z.object({
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrieved_at: z.iso.datetime({ offset: true }),
});

export const SanitationFileSchema = z.object({
  year: z.literal(2025),
  source: SourceSchema,
  note: z.string().min(1),
  regions: z.record(RegionCodeSchema, z.object({ percent: PercentSchema.nullable() })),
});

export type SanitationFile = z.infer<typeof SanitationFileSchema>;
