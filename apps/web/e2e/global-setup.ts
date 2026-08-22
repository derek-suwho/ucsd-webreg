import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireE2eDatabaseUrl } from './environment'

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const PRISMA_SCHEMA = resolve(REPOSITORY_ROOT, 'packages/db/prisma/schema.prisma')

function corepackCommand(): string {
  return process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
}

export default async function globalSetup(): Promise<void> {
  const databaseUrl = requireE2eDatabaseUrl({ TEST_DATABASE_URL: process.env.TEST_DATABASE_URL })

  execFileSync(corepackCommand(), [
    'npm', 'exec', '--', 'prisma', 'migrate', 'reset', '--force', '--skip-seed', '--schema', PRISMA_SCHEMA
  ], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit'
  })
  execFileSync(corepackCommand(), ['npm', 'exec', '--', 'tsx', 'apps/web/e2e/seed.ts'], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit'
  })
}
