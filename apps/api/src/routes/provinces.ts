import {
  ErrorResponseSchema,
  PROVINCE_REGIONS_MAX_LIMIT,
  ProvinceListQuerySchema,
  ProvinceListResponseSchema,
  ProvinceRegionsParamsSchema,
  ProvinceRegionsQuerySchema,
  ProvinceRegionsResponseSchema,
} from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';

import type { AppDependencies } from '#api/dependencies';
import { cacheControl } from '#api/plugins/cache-control';
import { dataAccess } from '#api/plugins/data-access';
import { requestContext } from '#api/plugins/request-context';
import { listProvinceRegions, listProvinces } from '#api/services/reference-service';

// Elysia validates params/query and every declared response against the shared Zod contracts.
export function createProvinceRoutes(dependencies: AppDependencies) {
  return new Elysia({ name: 'province-routes' })
    .use(requestContext)
    .use(cacheControl)
    .use(dataAccess(dependencies))
    .get(
      '/provinsi',
      async ({ envelope, withReferences }) =>
        envelope({ items: await withReferences(listProvinces) }),
      {
        cache: 'referenceList',
        query: ProvinceListQuerySchema,
        response: { 200: ProvinceListResponseSchema, 400: ErrorResponseSchema },
      },
    )
    .get(
      '/provinsi/:kode/daerah',
      async ({ params, query, envelope, fail, withReferences }) => {
        const result = await withReferences((repository) =>
          listProvinceRegions(repository, {
            provinceCode: params.kode,
            cursor: query.cursor,
            limit: query.limit ?? PROVINCE_REGIONS_MAX_LIMIT,
          }),
        );

        switch (result.kind) {
          case 'invalid-cursor':
            return fail('INVALID_QUERY', [{ field: 'cursor', message: 'cursor tidak valid.' }]);
          case 'province-not-found':
            return fail('PROVINSI_NOT_FOUND');
          case 'found':
            return envelope({
              province: result.province,
              items: result.items,
              next_cursor: result.nextCursor,
            });
          default: {
            const unreachable: never = result;
            return unreachable;
          }
        }
      },
      {
        cache: 'referenceList',
        params: ProvinceRegionsParamsSchema,
        query: ProvinceRegionsQuerySchema,
        response: {
          200: ProvinceRegionsResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    );
}
