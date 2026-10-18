import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../database/migrations', import.meta.url));
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const CONFIRM_FLAG = '--confirm-target=';

const connectionString = process.env.MIGRATION_DATABASE_URL;

if (connectionString === undefined || connectionString === '') {
  throw new Error(
    'MIGRATION_DATABASE_URL is required. Use the migration role, never the runtime role.',
  );
}

const target = new URL(connectionString);
const targetLabel = `${target.hostname}:${target.port || '5432'}${target.pathname}`;
const confirmedTarget = process.argv
  .find((argument) => argument.startsWith(CONFIRM_FLAG))
  ?.slice(CONFIRM_FLAG.length);

// Shared databases require the operator to retype the target so a stale env var cannot migrate
// the wrong environment by accident.
if (!LOCAL_HOSTS.has(target.hostname) && confirmedTarget !== targetLabel) {
  throw new Error(
    `Refusing to migrate non-local database ${targetLabel}. Re-run with ${CONFIRM_FLAG}${targetLabel}`,
  );
}

console.info(`Applying migrations from ${MIGRATIONS_FOLDER} to ${targetLabel}`);

const pool = new Pool({ connectionString, max: 1 });

try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  console.info('Migrations applied.');
} finally {
  await pool.end();
}
