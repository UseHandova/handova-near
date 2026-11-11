/**
 * End-to-end tests: real browser → real web app → real API → real NEAR testnet contracts.
 *
 *   bun run setup:e2e   # once: your own testnet deployment with 20-second waiting periods
 *   bun run test:e2e
 *
 * Runs against deploy/testnet.e2e.json + .env.e2e, never the shared deployment.
 * Tests run one at a time: they share one relayer key (parallel sends would collide on nonces).
 */
import { defineConfig, devices } from '@playwright/test';

const API_PORT = Number(process.env.E2E_API_PORT ?? 3099);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199); // override when another app holds the port

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 6 * 60_000,
  expect: { timeout: 60_000 },
  // The suite runs against public testnet RPCs; one retry absorbs network blips. Playwright reports such tests as "flaky".
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    ...devices['iPhone 13'],
    baseURL: `http://localhost:${WEB_PORT}`,
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile-chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `bun --env-file=.env.e2e run server/index.ts`,
      url: `http://localhost:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), NEAR_DEPLOY_FILE: 'deploy/testnet.e2e.json', KEEPER: 'off', RATE_LIMIT_SCALE: '100', MEDIA_DIR: 'test-results/uploads', VIEWING_DATA_FILE: 'test-results/viewings.json', VIEWING_MIN_LEAD_MIN: '0', VIEWING_OPENS_BEFORE_MIN: '60' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `bunx vite --config web/vite.config.ts --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { VITE_API_PROXY: `http://localhost:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
