import { defineConfig, devices } from '@playwright/test'

// PORT lets a second copy run beside the phone preview (npm run test:published uses 4241).
const port = Number(process.env.PORT || 4240)

export default defineConfig({
  testDir: 'tests',
  timeout: 90000,
  use: { baseURL: `http://localhost:${port}/sort-it/` },
  webServer: { command: `node tests/serve.mjs ${port}`, port, reuseExistingServer: !process.env.PORT },
  projects: [
    // iPhone-sized in Chrome: Playwright's WebKit doesn't run on this computer's Linux version.
    { name: 'iphone', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'small', use: { viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true } },
  ],
})
