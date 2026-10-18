import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import {
  ErrorResponseSchema,
  HealthResponseSchema,
  ProvinceListResponseSchema,
  ProvinceRegionsResponseSchema,
  RegionSearchResponseSchema,
} from '@jaga-daerah/contracts';

import { TEST_DATABASE_STARTUP_TIMEOUT_MS, startTestDatabase } from '../db/support/test-database';
import type { TestDatabase } from '../db/support/test-database';

const WORKER_STARTUP_TIMEOUT_MS = 60_000;
const READY_PATTERN = /Ready on (http:\/\/127\.0\.0\.1:\d+)/;
const API_WORKSPACE_DIRECTORY = fileURLToPath(new URL('../..', import.meta.url));

type WranglerProcess = Bun.Subprocess<'ignore', 'pipe', 'inherit'>;

function findFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

function waitForReadyUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let output = '';
    let isReady = false;

    // Keep consuming after startup so a full stdout pipe cannot block wrangler during the tests.
    void (async () => {
      try {
        for await (const chunk of stream) {
          if (isReady) {
            continue;
          }

          output += decoder.decode(chunk, { stream: true });
          const url = READY_PATTERN.exec(output)?.[1];
          if (url !== undefined) {
            isReady = true;
            resolve(url);
          }
        }
      } catch {
        // The stream errors when the process tree is killed during teardown.
      }

      if (!isReady) {
        reject(new Error(`wrangler dev exited before becoming ready:\n${output}`));
      }
    })();
  });
}

async function stopProcessTree(wrangler: WranglerProcess): Promise<void> {
  // On Windows, killing the `bun run` wrapper leaves wrangler's node and workerd children orphaned.
  if (process.platform === 'win32') {
    Bun.spawnSync(['taskkill', '/PID', String(wrangler.pid), '/T', '/F']);
  } else {
    wrangler.kill('SIGTERM');
  }

  await wrangler.exited;
}

// Runs the bundled Worker in workerd through `wrangler dev`, with the Hyperdrive binding pointed at
// a disposable PostgreSQL via its local connection string. This proves `pg` + `nodejs_compat`
// + Drizzle work in the Cloudflare runtime, not only in Bun. A subprocess is used because
// wrangler's in-process `unstable_startWorker` proxy does not answer requests when hosted by Bun.
describe('Worker runtime', () => {
  let database: TestDatabase | undefined;
  let wrangler: WranglerProcess | undefined;
  let baseUrl = '';

  beforeAll(async () => {
    database = await startTestDatabase();
    wrangler = Bun.spawn(
      [
        'bun',
        'run',
        'wrangler',
        'dev',
        '--env',
        'local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(findFreePort()),
      ],
      {
        cwd: API_WORKSPACE_DIRECTORY,
        env: {
          ...process.env,
          WRANGLER_SEND_METRICS: 'false',
          // The runtime role is read-only, matching production grants.
          CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: database.runtimeUrl,
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'inherit',
      },
    );
    baseUrl = await waitForReadyUrl(wrangler.stdout);
  }, WORKER_STARTUP_TIMEOUT_MS + TEST_DATABASE_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    if (wrangler !== undefined) {
      await stopProcessTree(wrangler);
    }
    await database?.stop();
  });

  test('GET /v1/health returns the success envelope with request ID and no-store', async () => {
    const response = await fetch(`${baseUrl}/v1/health`);
    const body = HealthResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Request-Id')).toBe(body.meta.request_id);
  });

  test('GET /v1/provinsi reads PostgreSQL through the Hyperdrive binding', async () => {
    const response = await fetch(`${baseUrl}/v1/provinsi`);
    const body = ProvinceListResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.data.items.map(({ code }) => code)).toEqual(['11', '32']);
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=86400');
  });

  test('GET /v1/provinsi/:kode/daerah paginates in workerd', async () => {
    const response = await fetch(`${baseUrl}/v1/provinsi/32/daerah?limit=2`);
    const body = ProvinceRegionsResponseSchema.parse(await response.json());

    expect(body.data.items.map(({ code }) => code)).toEqual(['32.04', '32.17']);
    expect(body.data.next_cursor).not.toBeNull();
  });

  test('GET /v1/daerah/search ranks results in workerd', async () => {
    const response = await fetch(`${baseUrl}/v1/daerah/search?q=bandung`);
    const body = RegionSearchResponseSchema.parse(await response.json());

    expect(body.data.items.map(({ code }) => code)).toEqual(['32.04', '32.73', '32.17']);
  });

  test('invalid input and unknown routes return error envelopes', async () => {
    const invalid = await fetch(`${baseUrl}/v1/daerah/search?q=b`);
    const missing = await fetch(`${baseUrl}/health`);

    expect(invalid.status).toBe(400);
    expect(ErrorResponseSchema.parse(await invalid.json()).error.code).toBe('INVALID_QUERY');
    expect(missing.status).toBe(404);
    expect(ErrorResponseSchema.parse(await missing.json()).error.code).toBe('NOT_FOUND');
  });
});
