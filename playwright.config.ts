import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:8788', viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'npm run build && node scripts/e2e-server.mjs',
    url: 'http://localhost:8788',
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: 'list',
});
