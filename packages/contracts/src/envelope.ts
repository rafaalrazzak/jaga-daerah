import { z } from 'zod';

export const SuccessMetaSchema = z.object({
  request_id: z.string().min(1),
  // Null when the response does not depend on a published dataset (health, reference data).
  dataset_version: z.string().min(1).nullable(),
  generated_at: z.iso.datetime(),
});

export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: SuccessMetaSchema });
}

export const ERROR_CODES = [
  'INVALID_QUERY',
  'NOT_FOUND',
  'PROVINSI_NOT_FOUND',
  'DAERAH_NOT_FOUND',
  'YEAR_NOT_AVAILABLE',
  'RATE_LIMITED',
  'ASSISTANT_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string().min(1),
    details: z.array(ErrorDetailSchema).nullable(),
    request_id: z.string().min(1),
  }),
});

export type SuccessMeta = z.infer<typeof SuccessMetaSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
