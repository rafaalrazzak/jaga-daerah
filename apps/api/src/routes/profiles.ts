import {
  ErrorResponseSchema,
  MapRealizationQuerySchema,
  MapRealizationResponseSchema,
  MetaStatusResponseSchema,
  ProfileParamsSchema,
  ProfileQuerySchema,
  RegionProfileResponseSchema,
} from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';

import type { AppDependencies } from '#api/dependencies';
import { cacheControl } from '#api/plugins/cache-control';
import { dataAccess } from '#api/plugins/data-access';
import { requestContext } from '#api/plugins/request-context';
import { getMapRealization, getMetaStatus, getRegionProfile } from '#api/services/profile-service';

export function createProfileRoutes(dependencies: AppDependencies) {
  return new Elysia({ name: 'profile-routes' })
    .use(requestContext)
    .use(cacheControl)
    .use(dataAccess(dependencies))
    .get(
      '/daerah/:slug',
      async ({ params, query, envelope, fail, withProfiles }) => {
        const result = await withProfiles((repository) =>
          getRegionProfile(repository, { slug: params.slug, year: query.year }),
        );

        switch (result.kind) {
          case 'region-not-found':
            return fail('DAERAH_NOT_FOUND');
          case 'no-published-dataset':
            return fail('YEAR_NOT_AVAILABLE', [
              { field: 'year', message: 'Belum ada dataset yang dipublikasikan.' },
            ]);
          case 'year-unavailable':
            return fail('YEAR_NOT_AVAILABLE', [
              {
                field: 'year',
                message:
                  result.availableYears.length > 0
                    ? `Tahun tersedia: ${result.availableYears.join(', ')}.`
                    : 'Belum ada data untuk daerah ini.',
              },
            ]);
          case 'found':
            return envelope(result.profile, result.datasetVersion);
          default: {
            const unreachable: never = result;
            return unreachable;
          }
        }
      },
      {
        cache: 'profile',
        params: ProfileParamsSchema,
        query: ProfileQuerySchema,
        response: {
          200: RegionProfileResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/peta/realisasi',
      async ({ query, envelope, fail, withProfiles }) => {
        const result = await withProfiles((repository) =>
          getMapRealization(repository, { year: query.year }),
        );
        switch (result.kind) {
          case 'no-published-dataset':
            return fail('YEAR_NOT_AVAILABLE', [
              { field: 'year', message: 'Belum ada dataset yang dipublikasikan.' },
            ]);
          case 'year-unavailable':
            return fail('YEAR_NOT_AVAILABLE', [
              { field: 'year', message: `Tahun tersedia: ${result.availableYears.join(', ')}.` },
            ]);
          case 'found':
            return envelope(result.map, result.datasetVersion);
          default: {
            const unreachable: never = result;
            return unreachable;
          }
        }
      },
      {
        cache: 'profile',
        query: MapRealizationQuerySchema,
        response: {
          200: MapRealizationResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    )
    .get(
      '/meta/status',
      async ({ envelope, withProfiles }) => {
        const { status, datasetVersion } = await withProfiles(getMetaStatus);
        return envelope(status, datasetVersion);
      },
      {
        cache: 'status',
        response: { 200: MetaStatusResponseSchema },
      },
    );
}
