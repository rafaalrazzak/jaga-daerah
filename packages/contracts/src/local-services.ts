import { z } from 'zod';

const CountSchema = z.number().int().nonnegative();
const REGION = z.string().regex(/^[0-9]{2}\.[0-9]{2}$/);

const SourceSchema = z.object({
  publisher: z.string().min(1),
  title: z.string().min(1),
  url: z.url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrieved_at: z.iso.datetime({ offset: true }),
});

export const HospitalCountSchema = z.object({
  total: CountSchema,
  umum: CountSchema,
  ibu_anak: CountSchema,
  khusus: CountSchema,
});

export const SchoolCountSchema = z.object({
  sd: CountSchema,
  smp: CountSchema,
  sma: CountSchema,
  smk: CountSchema,
});

const PopulationCountSchema = z.object({
  total: CountSchema,
  male: CountSchema,
  female: CountSchema,
});

export const LocalServicesFileSchema = z.object({
  hospitals: z.object({
    source: SourceSchema,
    coordinates: SourceSchema,
    omitted: CountSchema,
    note: z.string().min(1),
  }),
  schools: z.object({
    source: SourceSchema,
    note: z.string().min(1),
  }),
  population: z.object({
    source: SourceSchema,
    as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    national_total: CountSchema,
    note: z.string().min(1),
  }),
  regions: z.record(
    REGION,
    z.object({
      hospitals: HospitalCountSchema.nullable(),
      schools: SchoolCountSchema.nullable(),
      population: PopulationCountSchema.nullable(),
    }),
  ),
});

export type LocalServicesFile = z.infer<typeof LocalServicesFileSchema>;
export type HospitalCount = z.infer<typeof HospitalCountSchema>;
export type SchoolCount = z.infer<typeof SchoolCountSchema>;
export type PopulationCount = z.infer<typeof PopulationCountSchema>;
