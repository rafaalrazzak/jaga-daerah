import {
  ErrorResponseSchema,
  LiveConditionsResponseSchema,
  LiveParamsSchema,
  LiveQuerySchema,
  NationalBriefResponseSchema,
} from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';

import type { AppDependencies } from '#api/dependencies';
import { cacheControl } from '#api/plugins/cache-control';
import { requestContext } from '#api/plugins/request-context';
import { findLivePoint } from '#api/repositories/live-points';
import { forecastPlace, getLiveConditions, getNationalBrief } from '#api/services/live-conditions';

export function createLiveRoutes(dependencies: AppDependencies) {
  return new Elysia({ name: 'live-routes' })
    .use(requestContext)
    .use(cacheControl)
    .get(
      '/daerah/:slug/terkini',
      async ({ params, query, envelope, fail }) => {
        const point = findLivePoint(params.slug);
        if (point === undefined) return fail('DAERAH_NOT_FOUND');
        const place = forecastPlace(point, query.kecamatan);
        if (place === undefined) {
          return fail('INVALID_QUERY', [
            { field: 'kecamatan', message: 'Kecamatan tidak termasuk daerah ini.' },
          ]);
        }
        const conditions = await getLiveConditions(point, place, {
          fetchUpstream: dependencies.fetchUpstream,
          firmsMapKey: dependencies.firmsMapKey,
          ...(dependencies.ispuApiToken === undefined
            ? {}
            : { ispuApiToken: dependencies.ispuApiToken }),
          now: new Date(),
        });
        return envelope(conditions, null);
      },
      {
        cache: 'live',
        params: LiveParamsSchema,
        query: LiveQuerySchema,
        response: {
          200: LiveConditionsResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/terkini',
      async ({ envelope }) => {
        const brief = await getNationalBrief({
          fetchUpstream: dependencies.fetchUpstream,
          firmsMapKey: dependencies.firmsMapKey,
          ...(dependencies.ispuApiToken === undefined
            ? {}
            : { ispuApiToken: dependencies.ispuApiToken }),
          now: new Date(),
        });
        return envelope(brief, null);
      },
      {
        cache: 'live',
        response: { 200: NationalBriefResponseSchema },
      },
    );
}
