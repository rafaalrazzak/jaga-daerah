import { Elysia } from 'elysia';

import { NO_STORE } from './request-context';

// PRD §16 cache table: reference lists 24 h at the edge, search 1 h. Errors always override with
// no-store (see `failure`), so a route's policy only reaches successful responses.
export const CACHE_POLICIES = {
  none: NO_STORE,
  referenceList: 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
  search: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
  profile: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  status: 'public, max-age=60, s-maxage=300',
} as const;

export type CachePolicy = keyof typeof CACHE_POLICIES;

/** Route option `cache: '<policy>'` sets Cache-Control declaratively. */
export const cacheControl = new Elysia({ name: 'cache-control' }).macro({
  cache: (policy: CachePolicy) => ({
    beforeHandle({ set }) {
      set.headers['cache-control'] = CACHE_POLICIES[policy];
    },
  }),
});
