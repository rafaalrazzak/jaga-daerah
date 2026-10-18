import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import { treaty } from '@elysiajs/eden';
import { ErrorResponseSchema, LiveConditionsResponseSchema } from '@jaga-daerah/contracts';

import { createApp } from '#api/app';
import { parseAllowedOrigins } from '#api/plugins/cors-policy';

const ALLOWED_ORIGIN = 'http://localhost:4321';
const DATABASE_FAILURE = 'connect ECONNREFUSED 10.0.0.1:5432 password=secret';

describe('createApp', () => {
  const consoleError = spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    consoleError.mockClear();
  });

  const app = createApp({
    openDatabase: () => {
      throw new Error(DATABASE_FAILURE);
    },
    allowedOrigins: [ALLOWED_ORIGIN],
    fetchUpstream: () => Promise.reject(new Error('no upstream in tests')),
    firmsMapKey: undefined,
  });
  const api = treaty(app);

  describe('CORS', () => {
    test('allows the exact configured origin without credentials and exposes the request ID', async () => {
      const { response } = await api.v1.health.get({ headers: { origin: ALLOWED_ORIGIN } });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      expect(response.headers.get('Access-Control-Expose-Headers')).toContain('x-request-id');
      expect(response.headers.get('Vary')).toBe('Origin');
    });

    test.each([
      'https://evil.example',
      'http://localhost:4321.evil.example',
      'https://localhost:4321',
    ])('does not grant origin %s', async (origin) => {
      const { response } = await api.v1.health.get({ headers: { origin } });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    test('answers preflight for allowed GET requests', async () => {
      const response = await app.handle(
        new Request('http://localhost/v1/daerah/search', {
          method: 'OPTIONS',
          headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'GET' },
        }),
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    });
  });

  describe('parseAllowedOrigins', () => {
    test('accepts bare origins', () => {
      expect(parseAllowedOrigins(' https://jagadaerah.id ,http://localhost:4321')).toEqual([
        'https://jagadaerah.id',
        'http://localhost:4321',
      ]);
    });

    test.each(['*', 'https://jagadaerah.id/', 'https://jagadaerah.id/app'])(
      'rejects %p',
      (value) => {
        expect(() => parseAllowedOrigins(value)).toThrow();
      },
    );
  });

  test('serves health without opening the database', async () => {
    const { data, status, response } = await api.v1.health.get();

    expect(status).toBe(200);
    expect(data?.data.status).toBe('ok');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Request-Id')).toBe(data?.meta.request_id ?? null);
  });

  test('does not serve routes outside the /v1 prefix', async () => {
    const response = await app.handle(new Request('http://localhost/health'));
    const body = ErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  test('validates input before touching the database', async () => {
    const { status } = await api.v1.daerah.search.get({ query: { q: 'b' } });

    expect(status).toBe(400);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('converts unexpected failures into a generic 500 envelope and logs once', async () => {
    const { error, status, response } = await api.v1.provinsi.get({ query: {} });
    const body = ErrorResponseSchema.parse(error?.value);

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Request-Id')).toBe(body.error.request_id);
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(consoleError).toHaveBeenCalledTimes(1);

    const [entry] = consoleError.mock.calls[0] ?? [];
    expect(JSON.parse(String(entry))).toMatchObject({
      level: 'error',
      request_id: body.error.request_id,
      route: '/v1/provinsi',
      status: 500,
      error_code: 'INTERNAL_ERROR',
    });
  });

  describe('live conditions', () => {
    test('answers without the database and marks unreachable feeds unavailable', async () => {
      const response = await app.handle(
        new Request('http://localhost/v1/daerah/kabupaten-bogor/terkini'),
      );
      const body = LiveConditionsResponseSchema.parse(await response.json());

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, s-maxage=120');
      expect(body.data.region.code).toBe('32.01');
      expect(body.data.forecast.status).toBe('unavailable');
      expect(body.data.warnings.status).toBe('unavailable');
      expect(body.data.hotspots.status).toBe('unavailable');
    });

    test('rejects a kecamatan outside the region', async () => {
      const response = await app.handle(
        new Request('http://localhost/v1/daerah/kabupaten-bogor/terkini?kecamatan=13.03.01'),
      );
      expect(response.status).toBe(400);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('INVALID_QUERY');
    });

    test('unknown slug is DAERAH_NOT_FOUND', async () => {
      const response = await app.handle(
        new Request('http://localhost/v1/daerah/kabupaten-tidak-ada/terkini'),
      );
      expect(response.status).toBe(404);
      expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe('DAERAH_NOT_FOUND');
    });
  });
});
