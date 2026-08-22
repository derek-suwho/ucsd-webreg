import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const queryRaw = vi.fn()
  return {
    queryRaw,
    PrismaClient: vi.fn(function PrismaClientMock(options: { datasourceUrl: string }) {
      void options
      return { $queryRaw: queryRaw }
    })
  }
})

vi.mock('@webreg/db', () => ({
  PrismaClient: mocks.PrismaClient
}))

import { buildReadinessDatabaseUrl, checkReadiness } from './readiness'

describe('database readiness boundary', () => {
  beforeEach(() => {
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://user:secret@database.example.test:5432/webreg?sslmode=require&sslaccept=strict'
    )
    mocks.queryRaw.mockReset()
    mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }])
    mocks.PrismaClient.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('adds native connection, pool, and socket bounds without dropping TLS options', () => {
    const bounded = new URL(buildReadinessDatabaseUrl(process.env.DATABASE_URL))

    expect(bounded.username).toBe('user')
    expect(bounded.password).toBe('secret')
    expect(bounded.searchParams.get('sslmode')).toBe('require')
    expect(bounded.searchParams.get('sslaccept')).toBe('strict')
    expect(bounded.searchParams.get('connection_limit')).toBe('1')
    expect(bounded.searchParams.get('connect_timeout')).toBe('1')
    expect(bounded.searchParams.get('pool_timeout')).toBe('1')
    expect(bounded.searchParams.get('socket_timeout')).toBe('1')
  })

  it('rejects Prisma verify-full instead of silently weakening the production contract', () => {
    expect(() => buildReadinessDatabaseUrl(
      'postgresql://user:secret@database.example.test:5432/webreg?sslmode=verify-full&sslaccept=strict',
      'production'
    )).toThrow('Production DATABASE_URL must use sslmode=require and sslaccept=strict')
  })

  it('reuses a dedicated bounded client for database probes', async () => {
    await expect(checkReadiness({ checkRedis: async () => undefined })).resolves.toBe(true)
    await expect(checkReadiness({ checkRedis: async () => undefined })).resolves.toBe(true)

    expect(mocks.PrismaClient).toHaveBeenCalledOnce()
    const options = mocks.PrismaClient.mock.calls[0]![0]
    expect(new URL(options.datasourceUrl).searchParams.get('socket_timeout')).toBe('1')
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2)
  })
})
