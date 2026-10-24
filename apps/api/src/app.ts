import { Elysia } from 'elysia';
import { CloudflareAdapter } from 'elysia/adapter/cloudflare-worker';

import type { AppDependencies } from '#api/dependencies';
import { cacheControl } from '#api/plugins/cache-control';
import { corsPolicy } from '#api/plugins/cors-policy';
import { errorHandler } from '#api/plugins/error-handler';
import { requestContext } from '#api/plugins/request-context';
import { createAssistantRoutes } from '#api/routes/assistant';
import { healthRoutes } from '#api/routes/health';
import { createLiveRoutes } from '#api/routes/live';
import { createProfileRoutes } from '#api/routes/profiles';
import { createProvinceRoutes } from '#api/routes/provinces';
import { createRegionRoutes } from '#api/routes/regions';

export function createApp(dependencies: AppDependencies) {
  // Cross-cutting plugins are registered once at the root, before the routes they cover.
  // Workers cannot run Elysia's default Bun adapter; routes are compiled before the first request.
  return new Elysia({ adapter: CloudflareAdapter, prefix: '/v1' })
    .use(corsPolicy(dependencies.allowedOrigins))
    .use(requestContext)
    .use(errorHandler)
    .use(cacheControl)
    .use(healthRoutes)
    .use(createAssistantRoutes(dependencies))
    .use(createProvinceRoutes(dependencies))
    .use(createRegionRoutes(dependencies))
    .use(createProfileRoutes(dependencies))
    .use(createLiveRoutes(dependencies))
    .compile();
}

/** Type-only export for Eden Treaty clients (apps/web). */
export type App = ReturnType<typeof createApp>;
