import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3100';
export default defineConfig({
  testDir: './tests',
  testMatch: 'e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  ...(process.env.E2E_EXTERNAL_SERVER === '1' ? {} : {
    webServer: {
      command: 'npm run migrate && npm run build && npm run dev',
      url: `${baseURL}/api/ready`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { NODE_ENV: 'test', PORT: String(new URL(baseURL).port || 3100), APP_ORIGIN: baseURL,
        AI_PROVIDER: 'local', EMAIL_PROVIDER: 'disabled' },
    },
  }),
});
