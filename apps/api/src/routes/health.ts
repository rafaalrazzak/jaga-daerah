import { HealthResponseSchema } from '@jaga-daerah/contracts';
import { Elysia } from 'elysia';

import { cacheControl } from '#api/plugins/cache-control';
import { requestContext } from '#api/plugins/request-context';

// Process liveness only: no database query and no dependency details (SECURITY.md).
export const healthRoutes = new Elysia({ name: 'health-routes' })
  .use(requestContext)
  .use(cacheControl)
  .get('/health', ({ envelope }) => envelope({ status: 'ok' }), {
    cache: 'none',
    response: { 200: HealthResponseSchema },
  });
