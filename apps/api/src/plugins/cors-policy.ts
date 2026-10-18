import { cors } from '@elysiajs/cors';

import { REQUEST_ID_HEADER } from './request-context';

const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Parses a comma-separated allowlist and rejects wildcards or anything that is not a bare origin. */
export function parseAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const origin = new URL(entry).origin;
      if (origin !== entry) {
        throw new Error(`CORS origin must be a bare origin like https://example.id, got ${entry}`);
      }
      return origin;
    });
}

/**
 * Exact-origin CORS for the public read-only API (SECURITY.md): no reflection of arbitrary
 * origins, no credentials, GET only, and the request ID exposed for client error reports.
 */
export function corsPolicy(allowedOrigins: readonly string[]) {
  return cors({
    origin: [...allowedOrigins],
    methods: ['GET', 'OPTIONS'],
    allowedHeaders: 'Accept, Content-Type',
    exposeHeaders: REQUEST_ID_HEADER,
    credentials: false,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  });
}
