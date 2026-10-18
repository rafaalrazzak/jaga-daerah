import { treaty } from '@elysiajs/eden';

import type { App } from '#api/app';

/**
 * Eden Treaty factory for browser clients (apps/web). Created here so `App` and Eden resolve the
 * same Elysia type copy; the only runtime code this pulls into a browser bundle is Eden itself.
 */
export function createApiTreaty(origin: string, fetcher?: typeof fetch) {
  return treaty<App>(origin, {
    // Keep ISO timestamps as strings so payloads match the Zod contracts exactly.
    parseDate: false,
    ...(fetcher === undefined ? {} : { fetcher }),
  });
}

export type ApiTreaty = ReturnType<typeof createApiTreaty>;
