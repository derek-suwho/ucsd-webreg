import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { migrateProduction } from './migrate-production.mjs'

const RUNTIME_URL =
  'postgresql://web_runtime:runtime-secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'
const MIGRATION_URL =
  'postgresql://web_migrator:migration-secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'
const VALID_ENV = {
  NODE_ENV: 'production',
  DATABASE_URL: RUNTIME_URL,
  MIGRATION_DATABASE_URL: MIGRATION_URL
}

function doubles() {
  return {
    execFileSync: vi.fn(() => Buffer.from('ok')),
    nodePath: '/usr/local/bin/node',
    prismaCliPath: '/app/node_modules/prisma/build/index.js'
  }
}

describe('production migration runner', () => {
  it.each([
    ['non-production NODE_ENV', { ...VALID_ENV, NODE_ENV: 'development' }],
    ['missing runtime URL', { ...VALID_ENV, DATABASE_URL: undefined }],
    ['missing migration URL', { ...VALID_ENV, MIGRATION_DATABASE_URL: undefined }],
    ['non-PostgreSQL runtime URL', { ...VALID_ENV, DATABASE_URL: 'mysql://db.example.com/webreg' }],
    ['plaintext runtime URL', { ...VALID_ENV, DATABASE_URL: RUNTIME_URL.split('?')[0] }],
    ['Prisma verify-full runtime URL', { ...VALID_ENV, DATABASE_URL: RUNTIME_URL.replace('require', 'verify-full') }],
    ['missing strict runtime acceptance', { ...VALID_ENV, DATABASE_URL: RUNTIME_URL.replace('&sslaccept=strict', '') }],
    ['invalid migration certificate acceptance', { ...VALID_ENV, MIGRATION_DATABASE_URL: MIGRATION_URL.replace('strict', 'accept_invalid_certs') }],
    ['duplicate migration TLS mode', { ...VALID_ENV, MIGRATION_DATABASE_URL: `${MIGRATION_URL}&sslmode=require` }],
    ['pg certificate bypass parameter', { ...VALID_ENV, DATABASE_URL: `${RUNTIME_URL}&ssl=no-verify` }],
    ['duplicate pg TLS override', { ...VALID_ENV, MIGRATION_DATABASE_URL: `${MIGRATION_URL}&ssl=true&ssl=0` }],
    ['identical runtime and migration URL', { ...VALID_ENV, MIGRATION_DATABASE_URL: RUNTIME_URL }],
    ['shared database role', {
      ...VALID_ENV,
      MIGRATION_DATABASE_URL: RUNTIME_URL.replace('runtime-secret', 'different-secret')
    }]
  ])('fails closed for %s before starting Prisma', (_name, environment) => {
    const dependencies = doubles()

    expect(() => migrateProduction(environment, dependencies)).toThrow('Production migration configuration invalid')
    expect(dependencies.execFileSync).not.toHaveBeenCalled()
  })

  it('runs Prisma directly with only the migration URL and bounded execution', () => {
    const dependencies = doubles()

    expect(migrateProduction(VALID_ENV, dependencies)).toBeUndefined()

    expect(dependencies.execFileSync).toHaveBeenCalledOnce()
    const [executable, args, options] = dependencies.execFileSync.mock.calls[0]
    expect(executable).toBe('/usr/local/bin/node')
    expect(args).toEqual([
      '/app/node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      expect.stringMatching(/packages\/db\/prisma\/schema\.prisma$/)
    ])
    expect(options.shell).toBe(false)
    expect(options.timeout).toBeGreaterThan(0)
    expect(options.timeout).toBeLessThanOrEqual(300_000)
    expect(options.killSignal).toBe('SIGTERM')
    expect(options.maxBuffer).toBeLessThanOrEqual(64 * 1024)
    expect(options.stdio).toBe('pipe')
    expect(options.env.DATABASE_URL).toBe(MIGRATION_URL)
    expect(options.env).not.toHaveProperty('MIGRATION_DATABASE_URL')
  })

  it('sanitizes child-process failures', () => {
    const dependencies = doubles()
    dependencies.execFileSync.mockImplementation(() => {
      throw new Error(`could not reach ${MIGRATION_URL}`)
    })

    expect(() => migrateProduction(VALID_ENV, dependencies)).toThrow('Production migration failed')
    try {
      migrateProduction(VALID_ENV, dependencies)
    } catch (error) {
      expect(error.message).not.toContain('migration-secret')
      expect(error.cause).toBeUndefined()
    }
  })

  it('is safe to invoke twice', () => {
    const dependencies = doubles()

    migrateProduction(VALID_ENV, dependencies)
    migrateProduction(VALID_ENV, dependencies)

    expect(dependencies.execFileSync).toHaveBeenCalledTimes(2)
  })

  it('prints only a sanitized configuration error from the CLI', () => {
    const result = spawnSync(process.execPath, ['scripts/migrate-production.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: RUNTIME_URL,
        MIGRATION_DATABASE_URL: RUNTIME_URL
      },
      encoding: 'utf8'
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('Production migration configuration invalid\n')
    expect(result.stderr).not.toContain('runtime-secret')
  })
})
