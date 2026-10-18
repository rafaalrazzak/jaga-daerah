import {
  ErrorResponseSchema,
  RegionSearchQuerySchema,
  RegionSearchResponseSchema,
  SEARCH_RESULT_MAX_LIMIT,
} from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';

import type { AppDependencies } from '#api/dependencies';
import { cacheControl } from '#api/plugins/cache-control';
import { dataAccess } from '#api/plugins/data-access';
import { requestContext } from '#api/plugins/request-context';
import { searchRegions } from '#api/services/reference-service';

export function createRegionRoutes(dependencies: AppDependencies) {
  return new Elysia({ name: 'region-routes' })
    .use(requestContext)
    .use(cacheControl)
    .use(dataAccess(dependencies))
    .get(
      '/daerah/search',
      async ({ query, envelope, withReferences }) =>
        envelope({
          items: await withReferences((repository) =>
            searchRegions(repository, {
              query: query.q,
              limit: query.limit ?? SEARCH_RESULT_MAX_LIMIT,
            }),
          ),
        }),
      {
        cache: 'search',
        query: RegionSearchQuerySchema,
        response: { 200: RegionSearchResponseSchema, 400: ErrorResponseSchema },
      },
    );
}
