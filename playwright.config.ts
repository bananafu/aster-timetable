import { defineConfig, devices } from '@playwright/test'

const browserSmokePort = 41739

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 4,
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/playwright',
  use: {
    baseURL: `http://127.0.0.1:${browserSmokePort}/aster-timetable/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], browserName: 'chromium' },
  }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${browserSmokePort} --strictPort`,
    url: `http://127.0.0.1:${browserSmokePort}/aster-timetable/`,
    reuseExistingServer: false,
  },
})
