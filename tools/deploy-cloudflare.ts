import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { directDatabaseUrl } from './direct-database-url';

const API_DIRECTORY = fileURLToPath(new URL('../apps/api', import.meta.url));
const WEB_DIRECTORY = fileURLToPath(new URL('../apps/web', import.meta.url));
const RAFA_ACCOUNT_ID = '3a119315d3029c81d529f8ef5e2b4291';
const PAGES_PROJECT = 'jaga-daerah';
const PAGES_ORIGIN = 'https://jaga-daerah.pages.dev';

interface CommandResult {
  stdout: string;
}

function run(
  command: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string },
): Promise<CommandResult> {
  const child = Bun.spawn({
    cmd: command,
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? 'ignore' : new TextEncoder().encode(options.input),
    stdout: 'pipe',
    stderr: 'inherit',
  });

  return new Response(child.stdout).text().then(async (stdout) => {
    process.stdout.write(stdout);
    const code = await child.exited;
    if (code !== 0) {
      throw new Error(`${command.join(' ')} exited with ${String(code)}`);
    }
    return { stdout };
  });
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (databaseUrl === undefined || databaseUrl === '') {
  console.error('Set DATABASE_URL to the Neon Postgres URL, then run bun run deploy again.');
  process.exit(1);
}

const whoami = await run(['bun', 'x', 'wrangler', 'whoami'], { cwd: API_DIRECTORY });
if (!whoami.stdout.includes(RAFA_ACCOUNT_ID)) {
  throw new Error('Wrangler is not logged into the Rafa Cloudflare account. Run wrangler login.');
}

const migrationUrl = directDatabaseUrl(databaseUrl);
const target = new URL(migrationUrl);
const targetLabel = `${target.hostname}:${target.port || '5432'}${target.pathname}`;

await run(['bun', 'run', 'scripts/migrate.ts', `--confirm-target=${targetLabel}`], {
  cwd: API_DIRECTORY,
  env: { ...process.env, MIGRATION_DATABASE_URL: migrationUrl },
});

const secretsDir = mkdtempSync(join(tmpdir(), 'jaga-deploy-'));
let deployed: CommandResult;
try {
  writeFileSync(join(secretsDir, 'secrets.json'), JSON.stringify({ DATABASE_URL: databaseUrl }));
  deployed = await run(
    [
      'bun',
      'x',
      'wrangler',
      'deploy',
      '--env',
      '',
      '--secrets-file',
      join(secretsDir, 'secrets.json'),
    ],
    { cwd: API_DIRECTORY },
  );
} finally {
  rmSync(secretsDir, { recursive: true, force: true });
}

const apiOrigin = /https:\/\/jaga-daerah-api\.[a-z0-9-]+\.workers\.dev/.exec(deployed.stdout)?.[0];
if (apiOrigin === undefined) {
  throw new Error('Worker deploy finished without a workers.dev URL.');
}

await run(['bun', 'run', 'build'], {
  cwd: WEB_DIRECTORY,
  env: { ...process.env, PUBLIC_API_ORIGIN: apiOrigin, PUBLIC_SITE_URL: PAGES_ORIGIN },
});

await run(
  [
    'bun',
    'x',
    'wrangler',
    'pages',
    'project',
    'create',
    PAGES_PROJECT,
    '--production-branch',
    'main',
  ],
  { cwd: WEB_DIRECTORY },
).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (!message.includes('exited with')) {
    throw error;
  }
});

await run(
  [
    'bun',
    'x',
    'wrangler',
    'pages',
    'deploy',
    'dist',
    '--project-name',
    PAGES_PROJECT,
    '--commit-dirty=true',
  ],
  { cwd: WEB_DIRECTORY },
);

console.info(`API: ${apiOrigin}`);
console.info(`Site: ${PAGES_ORIGIN}`);
