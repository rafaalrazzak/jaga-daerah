import type { ErrorCode, ErrorDetail, ErrorResponse } from '@jaga-daerah/contracts';
import { Elysia, status } from 'elysia';

export const REQUEST_ID_HEADER = 'x-request-id';
export const NO_STORE = 'no-store';

export const ERROR_STATUS = {
  INVALID_QUERY: 400,
  NOT_FOUND: 404,
  PROVINSI_NOT_FOUND: 404,
  DAERAH_NOT_FOUND: 404,
  YEAR_NOT_AVAILABLE: 404,
  RATE_LIMITED: 429,
  ASSISTANT_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

const ERROR_MESSAGE: Record<ErrorCode, string> = {
  INVALID_QUERY: 'Parameter permintaan tidak valid.',
  NOT_FOUND: 'Alamat tidak ditemukan.',
  PROVINSI_NOT_FOUND: 'Provinsi tidak ditemukan.',
  DAERAH_NOT_FOUND: 'Daerah tidak ditemukan.',
  YEAR_NOT_AVAILABLE: 'Data untuk tahun tersebut belum tersedia.',
  RATE_LIMITED: 'Terlalu banyak permintaan. Coba lagi nanti.',
  ASSISTANT_UNAVAILABLE:
    'Asisten sedang tidak dapat menjawab. Coba lagi atau gunakan pencarian daerah.',
  INTERNAL_ERROR: 'Terjadi kesalahan pada server.',
};

interface HeaderSetter {
  headers: Record<string, string | number>;
}

/** Reads the ID assigned in onRequest; also usable from onError, where derive may not have run. */
export function requestIdOf(set: HeaderSetter): string {
  const id = set.headers[REQUEST_ID_HEADER];
  return typeof id === 'string' ? id : crypto.randomUUID();
}

/** Builds the PRD §16.1 error envelope with its status and marks the response uncacheable. */
export function failure<const Code extends ErrorCode>(
  set: HeaderSetter,
  code: Code,
  details: ErrorDetail[] | null = null,
) {
  set.headers['cache-control'] = NO_STORE;
  const body: ErrorResponse = {
    error: { code, message: ERROR_MESSAGE[code], details, request_id: requestIdOf(set) },
  };
  return status(ERROR_STATUS[code], body);
}

/**
 * Request ID plus the standard success/error envelope builders for every route.
 * Routes `.use()` it explicitly for types; Elysia deduplicates it by name.
 */
export const requestContext = new Elysia({ name: 'request-context' })
  .onRequest(({ set }) => {
    set.headers[REQUEST_ID_HEADER] = crypto.randomUUID();
  })
  .derive({ as: 'global' }, ({ set }) => {
    const requestId = requestIdOf(set);

    return {
      requestId,
      // datasetVersion stays null for responses that do not read published facts.
      envelope: <const T>(data: T, datasetVersion: string | null = null) => ({
        data,
        meta: {
          request_id: requestId,
          dataset_version: datasetVersion,
          generated_at: new Date().toISOString(),
        },
      }),
      fail: <const Code extends ErrorCode>(code: Code, details: ErrorDetail[] | null = null) =>
        failure(set, code, details),
    };
  });
