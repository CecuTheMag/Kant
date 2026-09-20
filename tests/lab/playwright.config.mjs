import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './ui',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['junit', { outputFile: 'artifacts/ui-results.xml' }]],
  use: {
    baseURL: process.env.KANT_WEB_URL ?? 'http://web:80',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  outputDir: 'artifacts/ui',
});
