import { env } from 'cloudflare:workers';

import { createApp } from '#api/app';
import { resolveConnectionString } from '#api/db/connection-string';
import { createDatabase } from '#api/db/client';
import { parseAllowedOrigins } from '#api/plugins/cors-policy';

const UPSTREAM_TIMEOUT_MS = 6000;
// Secret (`wrangler secret put FIRMS_MAP_KEY`, or the git-ignored `.dev.vars` locally). Declared in
// wrangler.jsonc for stable types, but read defensively: a deployment without it still works.
const firmsMapKey: unknown = Reflect.get(env, 'FIRMS_MAP_KEY');
const ispuApiToken: unknown = Reflect.get(env, 'ISPU_API_TOKEN');
const allowedOrigins = env.CORS_ALLOWED_ORIGINS;
if (allowedOrigins === undefined) {
  throw new Error('CORS_ALLOWED_ORIGINS is not configured');
}

export default createApp({
  openDatabase: () =>
    createDatabase(
      resolveConnectionString(Reflect.get(env, 'DATABASE_URL'), Reflect.get(env, 'HYPERDRIVE')),
    ),
  allowedOrigins: parseAllowedOrigins(allowedOrigins),
  // Edge-cached subrequests keep every profile view from reaching BMKG (60 requests/min/IP) or
  // FIRMS directly; BMKG rejects some default client user agents, so the Worker names itself.
  fetchUpstream: (url, ttlSeconds, headers) =>
    fetch(url, {
      headers: {
        ...headers,
        'user-agent': 'JagaDaerah/0.1 (data publik; +https://github.com/)',
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheTtl: ttlSeconds, cacheEverything: true },
    }),
  firmsMapKey: typeof firmsMapKey === 'string' ? firmsMapKey : undefined,
  ispuApiToken: typeof ispuApiToken === 'string' ? ispuApiToken : undefined,
});
