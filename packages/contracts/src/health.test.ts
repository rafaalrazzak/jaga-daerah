import { describe, expect, test } from 'bun:test';

import { HealthResponseSchema } from './health';

const VALID_HEALTH_RESPONSE = {
  data: { status: 'ok' },
  meta: {
    request_id: '3f1c2b9e-6d0a-4a4f-9a51-2f3c8d7e1b20',
    dataset_version: null,
    generated_at: '2026-10-17T10:00:00.000Z',
  },
};

describe('HealthResponseSchema', () => {
  test('accepts the documented success envelope', () => {
    expect(HealthResponseSchema.safeParse(VALID_HEALTH_RESPONSE).success).toBe(true);
  });

  test('rejects a status other than ok', () => {
    const response = { ...VALID_HEALTH_RESPONSE, data: { status: 'degraded' } };

    expect(HealthResponseSchema.safeParse(response).success).toBe(false);
  });

  test('rejects a response without a request ID', () => {
    const { request_id: _requestId, ...metaWithoutRequestId } = VALID_HEALTH_RESPONSE.meta;
    const response = { ...VALID_HEALTH_RESPONSE, meta: metaWithoutRequestId };

    expect(HealthResponseSchema.safeParse(response).success).toBe(false);
  });

  test('rejects a generated_at value that is not an ISO 8601 timestamp', () => {
    const response = {
      ...VALID_HEALTH_RESPONSE,
      meta: { ...VALID_HEALTH_RESPONSE.meta, generated_at: '17/10/2026 10:00' },
    };

    expect(HealthResponseSchema.safeParse(response).success).toBe(false);
  });

  test('rejects an omitted dataset_version instead of treating it as null', () => {
    const { dataset_version: _datasetVersion, ...metaWithoutVersion } = VALID_HEALTH_RESPONSE.meta;
    const response = { ...VALID_HEALTH_RESPONSE, meta: metaWithoutVersion };

    expect(HealthResponseSchema.safeParse(response).success).toBe(false);
  });
});
