import { defineConfig, devices } from '@playwright/test'

const browserSmokePort = 41739
const browserSmokeRunId = process.env.TOKI_PLAYWRIGHT_RUN_ID
  ?? (process.env.TOKI_PLAYWRIGHT_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-'))
const browserSmokeOutput = `test-results/playwright/${browserSmokeRunId}`

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 4,
  forbidOnly: true,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: `${browserSmokeOutput}/report` }],
    ['json', { outputFile: `${browserSmokeOutput}/results.json` }],
  ],
  outputDir: `${browserSmokeOutput}/artifacts`,
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
