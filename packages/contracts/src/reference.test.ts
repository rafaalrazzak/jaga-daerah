import { describe, expect, test } from 'bun:test';

import { ErrorResponseSchema } from './envelope';
import {
  ProvinceRegionsParamsSchema,
  ProvinceRegionsQuerySchema,
  ProvinceRegionsResponseSchema,
  RegionSearchQuerySchema,
  RegionSearchResponseSchema,
} from './reference';

const META = {
  request_id: 'req-1',
  dataset_version: null,
  generated_at: '2026-10-17T10:00:00.000Z',
};

describe('RegionSearchQuerySchema', () => {
  test('normalizes whitespace and leaves limit to the API default', () => {
    expect(RegionSearchQuerySchema.parse({ q: '  kota   bandung ' })).toEqual({
      q: 'kota bandung',
    });
  });

  test('coerces limit from the query string', () => {
    expect(RegionSearchQuerySchema.parse({ q: 'ban', limit: '3' }).limit).toBe(3);
  });

  test.each([
    ['missing q', {}],
    ['one character after trimming', { q: ' b ' }],
    ['longer than 80 characters', { q: 'a'.repeat(81) }],
    ['LIKE wildcard percent', { q: 'ban%' }],
    ['LIKE wildcard underscore', { q: 'ban_ung' }],
    ['markup characters', { q: '<script>' }],
    ['limit above 10', { q: 'ban', limit: '11' }],
    ['limit below 1', { q: 'ban', limit: '0' }],
    ['non-integer limit', { q: 'ban', limit: '2.5' }],
    ['non-numeric limit', { q: 'ban', limit: 'ten' }],
    ['unknown parameter', { q: 'ban', year: '2024' }],
  ])('rejects %s', (_label, input) => {
    expect(RegionSearchQuerySchema.safeParse(input).success).toBe(false);
  });

  test('accepts apostrophes, hyphens, and dots used in Indonesian place names', () => {
    expect(RegionSearchQuerySchema.parse({ q: "Bau-Bau Kep. Sula 'x" }).q).toBe(
      "Bau-Bau Kep. Sula 'x",
    );
  });
});

describe('Province region listing input', () => {
  test('keeps the province code as a string with its leading digit', () => {
    expect(ProvinceRegionsParamsSchema.parse({ kode: '11' })).toEqual({ kode: '11' });
  });

  test.each(['1', '111', 'aa', '3.2'])('rejects province code %p', (kode) => {
    expect(ProvinceRegionsParamsSchema.safeParse({ kode }).success).toBe(false);
  });

  test('accepts an opaque base64url cursor without a limit', () => {
    expect(ProvinceRegionsQuerySchema.parse({ cursor: 'MzIuMDQ' })).toEqual({ cursor: 'MzIuMDQ' });
  });

  test('rejects cursors with characters outside base64url', () => {
    expect(ProvinceRegionsQuerySchema.safeParse({ cursor: 'a/b+c=' }).success).toBe(false);
  });
});

describe('response contracts', () => {
  const province = { code: '32', name: 'Jawa Barat', slug: 'jawa-barat' };

  test('accepts a search response with nested province', () => {
    const response = {
      data: {
        items: [
          { code: '32.73', name: 'Kota Bandung', slug: 'kota-bandung', type: 'kota', province },
        ],
      },
      meta: META,
    };

    expect(RegionSearchResponseSchema.safeParse(response).success).toBe(true);
  });

  test('rejects numeric region codes that would lose formatting', () => {
    const response = {
      data: {
        items: [{ code: 3273, name: 'Kota Bandung', slug: 'kota-bandung', type: 'kota', province }],
      },
      meta: META,
    };

    expect(RegionSearchResponseSchema.safeParse(response).success).toBe(false);
  });

  test('accepts a province region page with a null next_cursor', () => {
    const response = {
      data: {
        province,
        items: [
          {
            code: '32.04',
            name: 'Kabupaten Bandung',
            slug: 'kabupaten-bandung',
            type: 'kabupaten',
          },
        ],
        next_cursor: null,
      },
      meta: META,
    };

    expect(ProvinceRegionsResponseSchema.safeParse(response).success).toBe(true);
  });

  test('accepts the documented error envelope and rejects unknown codes', () => {
    const error = {
      error: {
        code: 'INVALID_QUERY',
        message: 'Parameter tidak valid.',
        details: [{ field: 'q', message: 'Kata kunci minimal 2 karakter.' }],
        request_id: 'req-1',
      },
    };

    expect(ErrorResponseSchema.safeParse(error).success).toBe(true);
    expect(
      ErrorResponseSchema.safeParse({ error: { ...error.error, code: 'TEAPOT' } }).success,
    ).toBe(false);
  });
});
