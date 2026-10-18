import { z } from 'zod';

import { successEnvelope } from './envelope';

export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 80;
export const SEARCH_RESULT_MAX_LIMIT = 10;
export const PROVINCE_REGIONS_MAX_LIMIT = 50;
const CURSOR_MAX_LENGTH = 64;

// Kemendagri codes stay strings so leading zeroes and dots survive every boundary.
export const ProvinceCodeSchema = z.string().regex(/^[0-9]{2}$/, 'Kode provinsi harus 2 digit.');
export const RegionCodeSchema = z.string().regex(/^[0-9]{2}\.[0-9]{2}$/);
export const SlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const RegionTypeSchema = z.enum(['kabupaten', 'kota']);

export const ProvinceSchema = z.object({
  code: ProvinceCodeSchema,
  name: z.string().min(1),
  slug: SlugSchema,
});

export const RegionSummarySchema = z.object({
  code: RegionCodeSchema,
  name: z.string().min(1),
  slug: SlugSchema,
  type: RegionTypeSchema,
  province: ProvinceSchema,
});

function limitSchema(max: number) {
  return z.coerce
    .number({ error: 'limit harus berupa angka.' })
    .int('limit harus bilangan bulat.')
    .min(1, 'limit minimal 1.')
    .max(max, `limit maksimal ${max}.`);
}

// Unknown query parameters are rejected (strict) so cache keys stay predictable (PRD §20).
export const ProvinceListQuerySchema = z.strictObject({});

export const ProvinceRegionsParamsSchema = z.strictObject({ kode: ProvinceCodeSchema });

export const ProvinceRegionsQuerySchema = z.strictObject({
  cursor: z
    .string()
    .min(1)
    .max(CURSOR_MAX_LENGTH)
    .regex(/^[A-Za-z0-9_-]+$/, 'cursor tidak valid.')
    .optional(),
  // Optional rather than defaulted so typed clients (Eden) may omit it; the API applies the default.
  limit: limitSchema(PROVINCE_REGIONS_MAX_LIMIT).optional(),
});

export const RegionSearchQuerySchema = z.strictObject({
  q: z
    .string()
    .transform((value) => value.normalize('NFKC').trim().replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(SEARCH_QUERY_MIN_LENGTH, `Kata kunci minimal ${SEARCH_QUERY_MIN_LENGTH} karakter.`)
        .max(SEARCH_QUERY_MAX_LENGTH, `Kata kunci maksimal ${SEARCH_QUERY_MAX_LENGTH} karakter.`)
        // Letters, digits, spaces, dot, apostrophe, hyphen. Excludes LIKE wildcards (% and _).
        .regex(/^[\p{L}\p{N} .'-]+$/u, 'Kata kunci hanya boleh berisi huruf, angka, dan spasi.'),
    ),
  limit: limitSchema(SEARCH_RESULT_MAX_LIMIT).optional(),
});

export const ProvinceListResponseSchema = successEnvelope(
  z.object({ items: z.array(ProvinceSchema) }),
);

export const ProvinceRegionsResponseSchema = successEnvelope(
  z.object({
    province: ProvinceSchema,
    items: z.array(RegionSummarySchema.omit({ province: true })),
    next_cursor: z.string().nullable(),
  }),
);

export const RegionSearchResponseSchema = successEnvelope(
  z.object({ items: z.array(RegionSummarySchema) }),
);

export type Province = z.infer<typeof ProvinceSchema>;
export type RegionSummary = z.infer<typeof RegionSummarySchema>;
export type RegionType = z.infer<typeof RegionTypeSchema>;
export type ProvinceRegionsQuery = z.infer<typeof ProvinceRegionsQuerySchema>;
export type RegionSearchQuery = z.infer<typeof RegionSearchQuerySchema>;
export type ProvinceListResponse = z.infer<typeof ProvinceListResponseSchema>;
export type ProvinceRegionsResponse = z.infer<typeof ProvinceRegionsResponseSchema>;
export type RegionSearchResponse = z.infer<typeof RegionSearchResponseSchema>;
