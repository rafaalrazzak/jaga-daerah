import { z } from 'zod';

// BPK's opinion on a region's financial statements (LKPD), from the national Portal Data BPK
// export. The four codes are BPK's own words. An empty year is omitted: BPK published nothing,
// which is not the same as an adverse opinion.
export const AuditOpinionCodeSchema = z.enum(['WTP', 'WDP', 'TW', 'TMP']);

const RegionCodeSchema = z.string().regex(/^\d{2}\.\d{2}$/);
const ProvinceCodeSchema = z.string().regex(/^\d{2}$/);

const OpinionYearSchema = z.object({
  year: z.number().int().min(2016).max(2024),
  opinion: AuditOpinionCodeSchema,
});

const OpinionSeriesSchema = z.object({
  years: z.array(OpinionYearSchema).min(1),
});

export const AuditOpinionFileSchema = z.object({
  latest_year: z.literal(2024),
  source: z.object({
    publisher: z.string().min(1),
    title: z.string().min(1),
    url: z.url(),
    page: z.url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    retrieved_at: z.iso.datetime({ offset: true }),
  }),
  labels: z.record(AuditOpinionCodeSchema, z.string().min(1)),
  note: z.string().min(1),
  provinces: z.record(ProvinceCodeSchema, OpinionSeriesSchema),
  regions: z.record(RegionCodeSchema, OpinionSeriesSchema),
});

export type AuditOpinionCode = z.infer<typeof AuditOpinionCodeSchema>;
export type AuditOpinionFile = z.infer<typeof AuditOpinionFileSchema>;
