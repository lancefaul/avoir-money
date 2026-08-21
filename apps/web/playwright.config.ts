import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Avoir Money e2e tests.
 *
 * Tests run against an isolated test environment:
 *   - Web: http://localhost:3003 (Vite dev server, proxies /api → :3002)
 *   - API: http://localhost:3002 (Hono API, connected to TEST database)
 *   - DB:  localhost:5433 (test database — never production)
 *
 * Global setup clones reference data (categories, accounts, etc.) from
 * production into the test DB so tests have realistic lookup data.
 *
 * Both servers are started automatically by Playwright via webServer config.
 * Make sure Docker containers are running before executing tests.
 */

const TEST_DB_URL = 'postgresql://budget:budget@localhost:5433/budget_tracker_test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // run sequentially — tests share a real DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single worker to avoid DB race conditions
  reporter: [['html', { open: 'never' }]],
  timeout: 30_000, // 30 s per test

  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],

  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../api',
      port: 3009,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB_URL,
        PORT: '3009',
        API_KEY: 'budget-tracker-dev-key',
        NODE_ENV: 'development',
      },
    },
    {
      command: 'npx vite --port 3010',
      port: 3010,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_API_KEY: 'budget-tracker-dev-key',
        VITE_API_TARGET: 'http://localhost:3009',
        VITE_PORT: '3010',
      },
    },
  ],
});
