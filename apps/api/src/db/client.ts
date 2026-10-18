import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

// Hyperdrive already pools connections at the edge; keep the per-execution pool small.
const MAX_CONNECTIONS_PER_EXECUTION = 5;

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

// Create one handle per request/execution context from the Hyperdrive binding's connection string.
// Never cache it at module scope: Worker I/O objects must not outlive the request that created them.
export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new Pool({ connectionString, max: MAX_CONNECTIONS_PER_EXECUTION });

  return {
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  };
}
