import { describe, expect, test } from 'bun:test';

import type { RegionSummary } from '@jaga-daerah/contracts';

import { ApiError, createApiClient } from './api-client';

const REGION: RegionSummary = {
  code: '32.73',
  name: 'Kota Bandung',
  slug: 'kota-bandung',
  type: 'kota',
  province: { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' },
};
const META = {
  request_id: 'req-1',
  dataset_version: null,
  generated_at: '2026-10-17T10:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clientReturning(response: () => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return response();
  }) as typeof fetch;
  return { client: createApiClient('https://api.example.id', fetcher), requests };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('createApiClient.searchRegions', () => {
  test('calls the versioned search route and returns contract-validated items', async () => {
    const { client, requests } = clientReturning(() =>
      jsonResponse(200, { data: { items: [REGION] }, meta: META }),
    );

    expect(await client.searchRegions('kota bandung', { limit: 5 })).toEqual([REGION]);
    const url = new URL(requests[0]?.url ?? '');
    expect(url.pathname).toBe('/v1/daerah/search');
    expect(url.searchParams.get('q')).toBe('kota bandung');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  test('maps the API error envelope to ApiError with code and request ID', async () => {
    const { client } = clientReturning(() =>
      jsonResponse(400, {
        error: {
          code: 'INVALID_QUERY',
          message: 'Parameter permintaan tidak valid.',
          details: null,
          request_id: 'req-9',
        },
      }),
    );

    const error = await rejectionOf(client.searchRegions('bb'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'api', code: 'INVALID_QUERY', requestId: 'req-9' });
  });

  test('rejects success bodies that break the shared contract (version skew)', async () => {
    const { client } = clientReturning(() =>
      jsonResponse(200, { data: { items: [{ ...REGION, code: 3273 }] }, meta: META }),
    );

    expect(await rejectionOf(client.searchRegions('bandung'))).toMatchObject({
      kind: 'invalid-response',
    });
  });

  test('reports network failures as ApiError(network)', async () => {
    const { client } = clientReturning(() => {
      throw new TypeError('Failed to fetch');
    });

    expect(await rejectionOf(client.searchRegions('bandung'))).toMatchObject({ kind: 'network' });
  });

  test('lets caller cancellations through unchanged', async () => {
    const controller = new AbortController();
    const { client } = clientReturning(() => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });

    const error = await rejectionOf(client.searchRegions('bandung', { signal: controller.signal }));

    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });
});
