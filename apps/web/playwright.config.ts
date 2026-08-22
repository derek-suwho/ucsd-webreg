import { defineConfig } from '@playwright/test'
import { requireE2eDatabaseUrl } from './e2e/environment'

const BASE_URL = 'http://localhost:3100'
const AUTH_SECRET = 'release-e2e-secret-0123456789abcdef'

const databaseUrl = requireE2eDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL })
process.env.DATABASE_URL = databaseUrl
process.env.NEXTAUTH_SECRET = AUTH_SECRET

const webServerEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
)
delete webServerEnv.REDIS_URL
Object.assign(webServerEnv, {
  DATABASE_URL: databaseUrl,
  CONTACT_EMAIL: 'planner-e2e@example.test',
  CATALOG_SOURCE: 'fixture',
  APP_ORIGIN: BASE_URL,
  AUTH_URL: BASE_URL,
  NEXTAUTH_SECRET: AUTH_SECRET,
  GOOGLE_CLIENT_ID: 'planner-e2e-client',
  GOOGLE_CLIENT_SECRET: 'planner-e2e-secret',
  TRUSTED_PROXY_HOPS: '0',
  ENABLE_HSTS: 'false'
})

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'corepack npm run dev -- --hostname 127.0.0.1 --port 3100',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: webServerEnv
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'chromium-mobile-375',
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true
      }
    }
  ]
})
