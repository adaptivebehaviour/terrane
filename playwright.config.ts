import { defineConfig } from '@playwright/test';

// End-to-end tests drive the real Electron app (built into out/ by `npm run build`) through Playwright's _electron API.
// They need the Electron binary and a display, so they run through `npm run test:e2e`, not the workspace-wide `npm test`.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
});
