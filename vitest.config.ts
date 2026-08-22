import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const disableWebStorageFlag = '--no-experimental-webstorage'
const workerExecArgv = process.allowedNodeEnvironmentFlags.has(disableWebStorageFlag)
  ? [disableWebStorageFlag]
  : []

// DB-backed tests (repo.test.ts, snapshot.test.ts, ...) share one Postgres instance
// and truncate/seed the same tables — run test files serially to avoid cross-file races.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./apps/web', import.meta.url)) }
  },
  test: {
    fileParallelism: false,
    execArgv: workerExecArgv,
    server: {
      deps: { inline: ['next-auth'] }
    }
  }
})
