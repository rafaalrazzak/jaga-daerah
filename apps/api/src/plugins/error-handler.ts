import type { ErrorDetail } from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';
import type { ValidationError } from 'elysia';

import { log } from '#api/observability/logger';

import { failure, requestIdOf } from './request-context';

function validationDetails(error: Readonly<ValidationError>): ErrorDetail[] {
  // Elysia reports object-level issues (e.g. unknown query keys) at path "root".
  const rootKeys = (error.valueError as { keys?: unknown } | undefined)?.keys;
  const rootField = Array.isArray(rootKeys) ? rootKeys.join(',') : error.type;

  return error.all.map((issue) => ({
    field: 'path' in issue && issue.path !== 'root' ? String(issue.path) : rootField,
    message: issue.message ?? 'Nilai tidak valid.',
  }));
}

/** Single place that converts thrown/framework errors into public envelopes and logs them once. */
export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' },
  ({ code, error, request, set }) => {
    switch (code) {
      case 'VALIDATION':
        // PRD §16.1 uses 400 INVALID_QUERY rather than Elysia's default 422.
        return failure(set, 'INVALID_QUERY', validationDetails(error));
      case 'NOT_FOUND':
        return failure(set, 'NOT_FOUND');
      default:
        log('error', 'request_failed', {
          request_id: requestIdOf(set),
          route: new URL(request.url).pathname,
          method: request.method,
          status: 500,
          error_code: 'INTERNAL_ERROR',
          error_name: error instanceof Error ? error.name : String(code),
          error_message: error instanceof Error ? error.message : 'Unknown error',
        });
        return failure(set, 'INTERNAL_ERROR');
    }
  },
);
