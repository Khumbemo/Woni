import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    // Safari's engine (WebKit): desktop, iPhone and iPad.
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'ipad',
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    port: 5173,
    timeout: 15000,
    reuseExistingServer: true,
  },
});
