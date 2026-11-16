import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests', fullyParallel: false, workers: 1, reporter: 'list',
  use: { baseURL: 'http://localhost:3101', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    { command: 'node test/fixture-server.mjs', url: 'http://localhost:3100/health', reuseExistingServer: false, env: { PORT: '3100' }, timeout: 10_000 },
    { command: 'npm run dev -- --hostname localhost --port 3101', url: 'http://localhost:3101/login', reuseExistingServer: false, env: { NODE_ENV: 'development', KLEVA_BACKEND_ORIGIN: 'http://localhost:3100', DASHBOARD_PUBLIC_ORIGIN: 'http://localhost:3101' }, timeout: 60_000 },
  ],
});
