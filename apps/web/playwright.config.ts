import { defineConfig, devices } from '@playwright/test';

const PREVIEW_PORT = 4329;
// Unresolvable on purpose: every API call in E2E is answered by page.route fixtures.
export const E2E_API_ORIGIN = 'http://api.e2e.test';

export default defineConfig({
  testDir: './e2e',
  // `.e2e.ts` keeps these files out of `bun test` discovery.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 640 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `bun run build && bun run preview --port ${PREVIEW_PORT}`,
    env: { PUBLIC_API_ORIGIN: E2E_API_ORIGIN },
    url: `http://localhost:${PREVIEW_PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
