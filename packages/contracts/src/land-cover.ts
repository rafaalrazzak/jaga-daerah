import { z } from 'zod';

// Provincial land cover from KLHK's 2023 PKTL rekapitulasi (thousand hectares, stored here as
// hectares). The national table separates primary forest, secondary forest, plantation forest,
// and everything that is not forest. It does not split mangrove, fields, or settlements.
export const LandCoverClassSchema = z.enum([
  'hutan_primer',
  'hutan_sekunder',
  'hutan_tanaman',
  'bukan_hutan',
]);

const HectareSchema = z.string().regex(/^\d{1,12}\.\d{2}$/);

export const LandCoverFileSchema = z.object({
  year: z.literal(2023),
  unit: z.literal('ha'),
  level: z.literal('provinsi'),
  source: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    retrieved_at: z.iso.datetime({ offset: true }),
  }),
  note: z.string().min(1),
  labels: z.record(LandCoverClassSchema, z.string().min(1)),
  provinces: z.record(
    z.string().regex(/^\d{2}$/),
    z.object({
      name: z.string().min(1),
      rows: z
        .array(
          z.object({
            class: LandCoverClassSchema,
            hectares: HectareSchema,
          }),
        )
        .length(4),
    }),
  ),
});

export type LandCoverClass = z.infer<typeof LandCoverClassSchema>;
export type LandCoverFile = z.infer<typeof LandCoverFileSchema>;
