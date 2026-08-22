import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import globalSetup from './global-setup'

const E2E_DATABASE_URL = 'postgresql://planner:test-only@127.0.0.1:5432/toolchain_e2e'

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('E2E toolchain', () => {
  afterEach(() => {
    vi.resetModules()
  })

  it('exposes a web-server command that enters through the declared npm version', async () => {
    const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL
    const originalDatabaseUrl = process.env.DATABASE_URL
    const originalNextAuthSecret = process.env.NEXTAUTH_SECRET
    const originalCi = process.env.CI
    process.env.TEST_DATABASE_URL = E2E_DATABASE_URL
    process.env.CI = 'true'

    try {
      const config = (await import('../playwright.config')).default

      expect(config.forbidOnly).toBe(true)
      expect(config.webServer).toMatchObject({
        command: 'corepack npm run dev -- --hostname 127.0.0.1 --port 3100'
      })
    } finally {
      restoreEnvironment('TEST_DATABASE_URL', originalTestDatabaseUrl)
      restoreEnvironment('DATABASE_URL', originalDatabaseUrl)
      restoreEnvironment('NEXTAUTH_SECRET', originalNextAuthSecret)
      restoreEnvironment('CI', originalCi)
    }
  })

  it.skipIf(process.platform === 'win32')('runs database setup through Corepack and local tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'webreg-e2e-toolchain-'))
    const callsPath = join(directory, 'corepack-calls.txt')
    const corepackPath = join(directory, 'corepack')
    const npxPath = join(directory, 'npx')
    const originalPath = process.env.PATH
    const originalCallsPath = process.env.COREPACK_CALLS
    const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL

    try {
      await writeFile(corepackPath, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$COREPACK_CALLS"\n')
      await writeFile(npxPath, '#!/bin/sh\nexit 81\n')
      await chmod(corepackPath, 0o755)
      await chmod(npxPath, 0o755)
      process.env.PATH = `${directory}:${originalPath ?? ''}`
      process.env.COREPACK_CALLS = callsPath
      process.env.TEST_DATABASE_URL = E2E_DATABASE_URL

      await expect(globalSetup()).resolves.toBeUndefined()

      const calls = (await readFile(callsPath, 'utf8')).trim().split('\n')
      expect(calls).toHaveLength(2)
      expect(calls[0]).toMatch(/^npm exec -- prisma migrate reset --force --skip-seed --schema \/.*\/packages\/db\/prisma\/schema\.prisma$/)
      expect(calls[1]).toBe('npm exec -- tsx apps/web/e2e/seed.ts')
    } finally {
      restoreEnvironment('PATH', originalPath)
      restoreEnvironment('COREPACK_CALLS', originalCallsPath)
      restoreEnvironment('TEST_DATABASE_URL', originalTestDatabaseUrl)
      await rm(directory, { recursive: true, force: true })
    }
  })
})
