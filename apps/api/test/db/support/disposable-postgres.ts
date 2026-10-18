import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DisposablePostgres {
  superuserUrl: (database: string) => string;
  roleUrl: (role: string, database: string) => string;
  stop: () => Promise<void>;
}

const SUPERUSER = 'postgres';
const UNUSED_PASSWORD = 'trust-auth-ignores-this';
const WINDOWS_INSTALL_ROOT = 'C:\\Program Files\\PostgreSQL';

function executable(binDirectory: string, name: string): string {
  return join(binDirectory, process.platform === 'win32' ? `${name}.exe` : name);
}

// Resolution order: POSTGRES_BIN_DIR, `pg_config --bindir` on PATH, newest Windows installer copy.
function findPostgresBinDirectory(): string {
  const configured = process.env.POSTGRES_BIN_DIR;
  if (configured !== undefined && configured !== '') {
    return configured;
  }

  const pgConfig = Bun.which('pg_config');
  if (pgConfig !== null) {
    const result = Bun.spawnSync([pgConfig, '--bindir']);
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  }

  if (process.platform === 'win32' && existsSync(WINDOWS_INSTALL_ROOT)) {
    const newestVersion = readdirSync(WINDOWS_INSTALL_ROOT)
      .filter((entry) => /^\d+$/.test(entry))
      .toSorted((left, right) => Number(right) - Number(left))[0];
    if (newestVersion !== undefined) {
      return join(WINDOWS_INSTALL_ROOT, newestVersion, 'bin');
    }
  }

  throw new Error('PostgreSQL binaries not found. Install PostgreSQL or set POSTGRES_BIN_DIR.');
}

function findFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command[0]} failed:\n${result.stderr.toString()}${result.stdout.toString()}`,
    );
  }
}

// The server inherits pg_ctl's stdio; piping it would keep spawnSync waiting for EOF forever.
// Diagnostics go to the cluster's server.log instead.
function serverLog(logPath: string): string {
  if (!existsSync(logPath)) {
    return '';
  }
  return readFileSync(logPath, 'utf8');
}

function runDetached(command: string[], logPath: string): void {
  const result = Bun.spawnSync(command, { stdout: 'ignore', stderr: 'ignore' });
  if (result.exitCode !== 0) {
    throw new Error(
      `${command[0]} failed with exit code ${result.exitCode}\n${serverLog(logPath)}`,
    );
  }
}

// Starts a throwaway PostgreSQL cluster in a temporary directory with trust auth on loopback only.
// Tests never touch a developer's existing server or need its credentials.
export async function startDisposablePostgres(): Promise<DisposablePostgres> {
  const binDirectory = findPostgresBinDirectory();
  const dataDirectory = await mkdtemp(join(tmpdir(), 'jaga-daerah-pg-'));
  const port = findFreePort();
  const pgCtl = executable(binDirectory, 'pg_ctl');
  const logPath = join(dataDirectory, 'server.log');
  let isRunning = false;

  const stop = async (): Promise<void> => {
    if (isRunning) {
      runDetached(
        [pgCtl, 'stop', '--pgdata', dataDirectory, '--mode', 'immediate', '--wait'],
        logPath,
      );
      isRunning = false;
    }
    // Only removes the temporary directory created above, never a repository path.
    await rm(dataDirectory, { recursive: true, force: true });
  };

  try {
    run([
      executable(binDirectory, 'initdb'),
      '--pgdata',
      dataDirectory,
      '--username',
      SUPERUSER,
      '--auth',
      'trust',
      '--encoding',
      'UTF8',
      '--locale',
      'C',
    ]);
    isRunning = true;
    runDetached(
      [
        pgCtl,
        'start',
        '--pgdata',
        dataDirectory,
        '--wait',
        '--log',
        logPath,
        '--options',
        `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off`,
      ],
      logPath,
    );
  } catch (error: unknown) {
    await stop();
    throw error;
  }

  // Trust auth ignores the password, but Wrangler's local Hyperdrive requires one in the URL.
  const roleUrl = (role: string, database: string): string =>
    `postgres://${role}:${UNUSED_PASSWORD}@127.0.0.1:${port}/${database}`;

  return { roleUrl, superuserUrl: (database) => roleUrl(SUPERUSER, database), stop };
}
