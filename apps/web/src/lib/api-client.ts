import { createApiTreaty } from '@jaga-daerah/api/client';
import {
  AssistantReplyResponseSchema,
  ErrorResponseSchema,
  LiveConditionsResponseSchema,
  MapRealizationResponseSchema,
  MetaStatusResponseSchema,
  NationalBriefResponseSchema,
  RegionProfileResponseSchema,
  RegionSearchResponseSchema,
} from '@jaga-daerah/contracts';
import type {
  AssistantMessage,
  AssistantReply,
  ErrorCode,
  LiveConditions,
  MapRealization,
  MetaStatus,
  NationalBrief,
  RegionProfileResponse,
  RegionSummary,
} from '@jaga-daerah/contracts';

const REQUEST_TIMEOUT_MS = 8_000;
const ASSISTANT_TIMEOUT_MS = 30_000;

export type ApiFailureKind = 'api' | 'network' | 'timeout' | 'invalid-response';

/** One error type for every failure, so UI code handles a single shape. */
export class ApiError extends Error {
  readonly kind: ApiFailureKind;
  readonly code: ErrorCode | undefined;
  readonly requestId: string | undefined;

  constructor(
    kind: ApiFailureKind,
    message: string,
    details: { code?: ErrorCode; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.code = details.code;
    this.requestId = details.requestId;
  }
}

export interface ApiClient {
  searchRegions(
    query: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<RegionSummary[]>;
  getRegionProfile(
    slug: string,
    options?: { year?: number; signal?: AbortSignal },
  ): Promise<RegionProfileResponse>;
  getMetaStatus(options?: { signal?: AbortSignal }): Promise<MetaStatus>;
  getMapRealization(options?: { year?: number; signal?: AbortSignal }): Promise<MapRealization>;
  getLiveConditions(
    slug: string,
    options?: { kecamatan?: string; signal?: AbortSignal },
  ): Promise<LiveConditions>;
  getNationalBrief(options?: { signal?: AbortSignal }): Promise<NationalBrief>;
  askAssistant(
    messages: readonly AssistantMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<AssistantReply>;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function failureFromStatus(value: unknown): ApiError {
  const parsed = ErrorResponseSchema.safeParse(value);
  return parsed.success
    ? new ApiError('api', parsed.data.error.message, {
        code: parsed.data.error.code,
        requestId: parsed.data.error.request_id,
      })
    : new ApiError('invalid-response', 'Respons server tidak dikenali.');
}

/** Eden reports transport failures (no Response) as status 503 with the original error. */
function transportFailure(
  cause: unknown,
  callerSignal: AbortSignal | undefined,
  timeout: AbortSignal,
) {
  if (callerSignal?.aborted === true && isAbort(cause)) {
    // Superseded by a newer keystroke; callers ignore cancellations.
    return cause;
  }
  if (timeout.aborted) {
    return new ApiError('timeout', 'Server terlalu lama merespons.');
  }
  return new ApiError('network', 'Tidak dapat terhubung ke server.');
}

interface EdenResult {
  data: unknown;
  error: { value: unknown } | null;
  response: Response | undefined;
}

/** Structural subset of a Zod schema, so the web does not depend on Zod directly. */
interface ResponseSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/**
 * One request with timeout, cancellation, error mapping, and runtime contract validation.
 * Eden types prove the call shape at compile time; the Zod parse guards against deploy skew.
 */
async function call<T>(
  schema: ResponseSchema<T>,
  callerSignal: AbortSignal | undefined,
  request: (signal: AbortSignal) => Promise<EdenResult>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout]);

  let result: EdenResult;
  try {
    result = await request(signal);
  } catch (error: unknown) {
    throw transportFailure(error, callerSignal, timeout);
  }

  if (result.error !== null) {
    throw result.response === undefined
      ? transportFailure(result.error.value, callerSignal, timeout)
      : failureFromStatus(result.error.value);
  }

  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new ApiError('invalid-response', 'Respons server tidak sesuai kontrak.');
  }
  return parsed.data;
}

/**
 * Eden Treaty client typed from the API's route contracts, wrapped in a framework-agnostic
 * interface so islands and tests depend only on `ApiClient`.
 */
export function createApiClient(apiOrigin: string, fetcher?: typeof fetch): ApiClient {
  const api = createApiTreaty(apiOrigin, fetcher);

  return {
    async searchRegions(query, options = {}) {
      const body = await call(RegionSearchResponseSchema, options.signal, (signal) =>
        api.v1.daerah.search.get({
          query: { q: query, ...(options.limit === undefined ? {} : { limit: options.limit }) },
          fetch: { signal },
        }),
      );
      return body.data.items;
    },

    getRegionProfile(slug, options = {}) {
      return call(RegionProfileResponseSchema, options.signal, (signal) =>
        api.v1.daerah({ slug }).get({
          query: options.year === undefined ? {} : { year: options.year },
          fetch: { signal },
        }),
      );
    },

    async getMetaStatus(options = {}) {
      const body = await call(MetaStatusResponseSchema, options.signal, (signal) =>
        api.v1.meta.status.get({ fetch: { signal } }),
      );
      return body.data;
    },

    async getMapRealization(options = {}) {
      const body = await call(MapRealizationResponseSchema, options.signal, (signal) =>
        api.v1.peta.realisasi.get({
          query: options.year === undefined ? {} : { year: options.year },
          fetch: { signal },
        }),
      );
      return body.data;
    },

    async getLiveConditions(slug, options = {}) {
      const body = await call(LiveConditionsResponseSchema, options.signal, (signal) =>
        api.v1.daerah({ slug }).terkini.get({
          query: options.kecamatan === undefined ? {} : { kecamatan: options.kecamatan },
          fetch: { signal },
        }),
      );
      return body.data;
    },

    async getNationalBrief(options = {}) {
      const body = await call(NationalBriefResponseSchema, options.signal, (signal) =>
        api.v1.terkini.get({ fetch: { signal } }),
      );
      return body.data;
    },

    async askAssistant(messages, options = {}) {
      const body = await call(
        AssistantReplyResponseSchema,
        options.signal,
        (signal) => api.v1.assistant.post({ messages: [...messages] }, { fetch: { signal } }),
        ASSISTANT_TIMEOUT_MS,
      );
      return body.data;
    },
  };
}

const DEFAULT_API_ORIGIN = 'http://localhost:8787';

export const apiClient = createApiClient(import.meta.env.PUBLIC_API_ORIGIN ?? DEFAULT_API_ORIGIN);
