import { env } from 'cloudflare:workers';

import { createApp } from '#api/app';
import { createDatabase } from '#api/db/client';
import { parseAllowedOrigins } from '#api/plugins/cors-policy';

export default createApp({
  openDatabase: () => createDatabase(env.HYPERDRIVE.connectionString),
  allowedOrigins: parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
});
