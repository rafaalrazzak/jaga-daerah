import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

import { createDatabase } from '#api/db/client';
import type { DatabaseHandle } from '#api/db/client';

import { startDisposablePostgres } from './disposable-postgres';
import type { DisposablePostgres } from './disposable-postgres';
import { seedReferenceData } from './seed';

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../../../../database/migrations', import.meta.url),
);
const ROLES_FOLDER = new URL('../../../../../database/roles/', import.meta.url);
const DATABASE_NAME = 'jaga_daerah_test';
export const RUNTIME_ROLE = 'jaga_readonly';
export const ETL_ROLE = 'jaga_etl';
export const TEST_DATABASE_STARTUP_TIMEOUT_MS = 60_000;

export interface TestDatabase {
  owner: DatabaseHandle;
  runtime: DatabaseHandle;
  etl: DatabaseHandle;
  ownerUrl: string;
  runtimeUrl: string;
  stop: () => Promise<void>;
}

async function runAsSuperuser(postgres: DisposablePostgres, database: string, statement: string) {
  const client = new Client({ connectionString: postgres.superuserUrl(database) });
  await client.connect();
  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

async function readRoleScript(name: string): Promise<string> {
  return readFile(fileURLToPath(new URL(name, ROLES_FOLDER)), 'utf8');
}

/**
 * Disposable cluster → empty database → committed migrations → role grants → deterministic seed.
 * Mirrors the deployment order so tests exercise the real artifacts.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const postgres = await startDisposablePostgres();
  const handles: DatabaseHandle[] = [];

  const stop = async () => {
    await Promise.all(handles.map((handle) => handle.close()));
    await postgres.stop();
  };

  try {
    await runAsSuperuser(postgres, 'postgres', `CREATE DATABASE ${DATABASE_NAME}`);
    await runAsSuperuser(postgres, 'postgres', `CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
    await runAsSuperuser(postgres, 'postgres', `CREATE ROLE ${ETL_ROLE} LOGIN`);

    const ownerUrl = postgres.superuserUrl(DATABASE_NAME);
    const owner = createDatabase(ownerUrl);
    handles.push(owner);
    await migrate(owner.db, { migrationsFolder: MIGRATIONS_FOLDER });
    await runAsSuperuser(postgres, DATABASE_NAME, await readRoleScript('runtime-readonly.sql'));
    await runAsSuperuser(postgres, DATABASE_NAME, await readRoleScript('etl-writer.sql'));
    await seedReferenceData(owner.db);

    const runtimeUrl = postgres.roleUrl(RUNTIME_ROLE, DATABASE_NAME);
    const runtime = createDatabase(runtimeUrl);
    const etl = createDatabase(postgres.roleUrl(ETL_ROLE, DATABASE_NAME));
    handles.push(runtime, etl);

    return { owner, runtime, etl, ownerUrl, runtimeUrl, stop };
  } catch (error: unknown) {
    await stop();
    throw error;
  }
}
