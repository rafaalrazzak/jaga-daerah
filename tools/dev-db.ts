/**
 * Local development database: a project-owned PostgreSQL cluster under `.local/postgres`
 * (gitignored), so `bun run dev` works without touching any existing server or its credentials.
 *
 *   bun run dev:db setup    create + migrate + grant + import regions and facts (idempotent)
 *   bun run dev:db start    start the cluster if it is not running (used by `bun run dev`)
 *   bun run dev:db stop
 *   bun run dev:db status
 *
 * Local only: trust authentication on 127.0.0.1. Never point this at a shared environment.
 */
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const DATA_DIRECTORY = join(ROOT, '.local', 'postgres', 'data');
const LOG_FILE = join(ROOT, '.local', 'postgres', 'server.log');
const PORT = Number(process.env['DEV_POSTGRES_PORT'] ?? 54329);
const DATABASE = 'jaga_daerah';
// Trust auth ignores passwords, but Wrangler's local Hyperdrive requires one in the URL.
const url = (role: string) => `postgres://${role}:local-dev@127.0.0.1:${PORT}/${DATABASE}`;
const RAW_ROOT = join(ROOT, 'tools', 'etl', 'data', 'raw');
// Outside apps/api on purpose: Wrangler would treat apps/api/.env as Worker vars and change the
// generated binding types. The API dev script loads this file with `bun --env-file`.
const API_ENV_FILE = join(ROOT, '.local', 'api.env');
const WINDOWS_INSTALL_ROOT = 'C:\\Program Files\\PostgreSQL';

function binDirectory(): string {
  const configured = process.env['POSTGRES_BIN_DIR'];
  if (configured) return configured;
  const pgConfig = Bun.which('pg_config');
  if (pgConfig !== null) {
    const result = Bun.spawnSync([pgConfig, '--bindir']);
    if (result.exitCode === 0) return result.stdout.toString().trim();
  }
  if (process.platform === 'win32' && existsSync(WINDOWS_INSTALL_ROOT)) {
    const newest = readdirSync(WINDOWS_INSTALL_ROOT)
      .filter((entry) => /^\d+$/.test(entry))
      .toSorted((left, right) => Number(right) - Number(left))[0];
    if (newest !== undefined) return join(WINDOWS_INSTALL_ROOT, newest, 'bin');
  }
  throw new Error('PostgreSQL binaries not found. Install PostgreSQL or set POSTGRES_BIN_DIR.');
}

function bin(name: string): string {
  return join(binDirectory(), process.platform === 'win32' ? `${name}.exe` : name);
}

function run(command: string[], env: Record<string, string> = {}): void {
  console.info(`$ ${command.join(' ')}`);
  const result = Bun.spawnSync(command, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(' ')}`);
  }
}

function query(sql: string, role = 'postgres', database = DATABASE): string {
  const result = Bun.spawnSync(
    [bin('psql'), '-h', '127.0.0.1', '-p', String(PORT), '-U', role, '-d', database, '-Atqc', sql],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0) {
    throw new Error(`psql failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function isRunning(): boolean {
  if (!existsSync(DATA_DIRECTORY)) return false;
  return (
    Bun.spawnSync([bin('pg_ctl'), 'status', '-D', DATA_DIRECTORY], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exitCode === 0
  );
}

function start(): void {
  if (!existsSync(DATA_DIRECTORY)) {
    throw new Error('No local database yet. Run `bun run dev:db setup` first.');
  }
  if (isRunning()) {
    console.info(`Local PostgreSQL already running on 127.0.0.1:${PORT}.`);
    return;
  }
  // stdio ignored: the server inherits it, and piping would keep this process waiting.
  const result = Bun.spawnSync(
    [
      bin('pg_ctl'),
      'start',
      '-D',
      DATA_DIRECTORY,
      '-w',
      '-l',
      LOG_FILE,
      '-o',
      `-p ${PORT} -c listen_addresses=127.0.0.1`,
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  );
  if (result.exitCode !== 0) {
    throw new Error(`pg_ctl start failed; see ${LOG_FILE}`);
  }
  console.info(`Local PostgreSQL started on 127.0.0.1:${PORT}.`);
}

function stop(): void {
  if (!isRunning()) {
    console.info('Local PostgreSQL is not running.');
    return;
  }
  run([bin('pg_ctl'), 'stop', '-D', DATA_DIRECTORY, '-m', 'fast', '-w']);
}

function latestSnapshot(source: string): string | undefined {
  const directory = join(RAW_ROOT, source);
  if (!existsSync(directory)) return undefined;
  return readdirSync(directory)
    .filter((entry) => existsSync(join(directory, entry, 'manifest.json')))
    .toSorted()
    .at(-1);
}

async function setup(): Promise<void> {
  if (!existsSync(DATA_DIRECTORY)) {
    await mkdir(DATA_DIRECTORY, { recursive: true });
    run([
      bin('initdb'),
      '-D',
      DATA_DIRECTORY,
      '-U',
      'postgres',
      '-A',
      'trust',
      '-E',
      'UTF8',
      '--locale',
      'C',
    ]);
  }
  start();

  if (
    query(`SELECT 1 FROM pg_database WHERE datname = '${DATABASE}'`, 'postgres', 'postgres') !== '1'
  ) {
    query(`CREATE DATABASE ${DATABASE}`, 'postgres', 'postgres');
  }
  for (const role of ['jaga_readonly', 'jaga_etl']) {
    if (query(`SELECT 1 FROM pg_roles WHERE rolname = '${role}'`, 'postgres', 'postgres') !== '1') {
      query(`CREATE ROLE ${role} LOGIN`, 'postgres', 'postgres');
    }
  }

  run(['bun', 'run', 'db:migrate'], { MIGRATION_DATABASE_URL: url('postgres') });
  for (const script of ['runtime-readonly.sql', 'etl-writer.sql']) {
    run([
      bin('psql'),
      '-h',
      '127.0.0.1',
      '-p',
      String(PORT),
      '-U',
      'postgres',
      '-d',
      DATABASE,
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      join(ROOT, 'database', 'roles', script),
    ]);
  }

  run(['bun', 'run', 'etl:regions', '--', '--load'], { ETL_DATABASE_URL: url('jaga_etl') });

  if (query("SELECT count(*) FROM dataset_versions WHERE status = 'active'") === '0') {
    if (latestSnapshot('djpk') === undefined || latestSnapshot('bnpb') === undefined) {
      console.info('No DJPK/BNPB snapshots yet; downloading (a few minutes, polite rate).');
      run(['bun', 'run', 'etl:fetch', '--', '--years', '2024,2025']);
    }
    const djpk = join(RAW_ROOT, 'djpk', latestSnapshot('djpk') ?? '');
    const bnpb = join(RAW_ROOT, 'bnpb', latestSnapshot('bnpb') ?? '');
    run(['bun', 'run', 'etl:publish', '--', '--djpk', djpk, '--bnpb', bnpb, '--load'], {
      ETL_DATABASE_URL: url('jaga_etl'),
    });
  } else {
    console.info('An active dataset version already exists; skipping publication.');
  }

  await writeFile(
    API_ENV_FILE,
    [
      '# Generated by `bun run dev:db setup` for local development only (gitignored).',
      '# Loaded by the @jaga-daerah/api dev script; emulates the Hyperdrive binding with the read-only role.',
      `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=${url('jaga_readonly')}`,
      '',
    ].join('\n'),
  );
  console.info(
    `\nReady. Wrote ${API_ENV_FILE}. Run \`bun run dev\` and open http://localhost:4321`,
  );
}

const command = process.argv[2];
switch (command) {
  case 'setup':
    await setup();
    break;
  case 'start':
    start();
    break;
  case 'stop':
    stop();
    break;
  case 'status':
    console.info(isRunning() ? `running on 127.0.0.1:${PORT}` : 'not running');
    break;
  default:
    console.error('Usage: bun run dev:db <setup|start|stop|status>');
    process.exit(2);
}
