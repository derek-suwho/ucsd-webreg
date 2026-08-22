import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { verifyCiServices } from './verify-ci-services.mjs'

const VALID_ENV = {
  DATABASE_URL: 'postgresql://planner:test-password@127.0.0.1:5432/planner',
  REDIS_URL: 'redis://127.0.0.1:6379'
}

function serviceDoubles() {
  const postgres = {
    connect: vi.fn(async () => {}),
    query: vi.fn(async () => ({ rows: [{ ready: 1 }] })),
    end: vi.fn(async () => {})
  }
  const redis = {
    isOpen: false,
    connect: vi.fn(async () => { redis.isOpen = true }),
    ping: vi.fn(async () => 'PONG'),
    destroy: vi.fn(() => { redis.isOpen = false }),
    on: vi.fn()
  }
  return {
    postgres,
    redis,
    dependencies: {
      createPostgresClient: vi.fn(() => postgres),
      createRedisClient: vi.fn(() => redis),
      timeoutMs: 100
    }
  }
}

describe('CI service verification', () => {
  it.each([
    ['DATABASE_URL', { REDIS_URL: VALID_ENV.REDIS_URL }],
    ['REDIS_URL', { DATABASE_URL: VALID_ENV.DATABASE_URL }]
  ])('fails closed when %s is missing', async (name, environment) => {
    const { dependencies } = serviceDoubles()

    await expect(verifyCiServices(environment, dependencies)).rejects.toThrow(`${name} is required`)
    expect(dependencies.createPostgresClient).not.toHaveBeenCalled()
    expect(dependencies.createRedisClient).not.toHaveBeenCalled()
  })

  it('connects to PostgreSQL, runs a query, pings Redis, and closes both clients', async () => {
    const { postgres, redis, dependencies } = serviceDoubles()

    await expect(verifyCiServices(VALID_ENV, dependencies)).resolves.toBeUndefined()

    expect(dependencies.createPostgresClient).toHaveBeenCalledWith({
      connectionString: VALID_ENV.DATABASE_URL,
      connectionTimeoutMillis: 100,
      query_timeout: 100
    })
    expect(postgres.connect).toHaveBeenCalledOnce()
    expect(postgres.query).toHaveBeenCalledWith('SELECT 1 AS ready')
    expect(postgres.end).toHaveBeenCalledOnce()
    expect(dependencies.createRedisClient).toHaveBeenCalledWith({
      url: VALID_ENV.REDIS_URL,
      socket: { connectTimeout: 100, reconnectStrategy: false }
    })
    expect(redis.connect).toHaveBeenCalledOnce()
    expect(redis.ping).toHaveBeenCalledOnce()
    expect(redis.destroy).toHaveBeenCalledOnce()
  })

  it('sanitizes readiness failures and still closes connected clients', async () => {
    const { postgres, redis, dependencies } = serviceDoubles()
    redis.ping.mockRejectedValue(new Error(`private endpoint ${VALID_ENV.REDIS_URL}`))

    await expect(verifyCiServices(VALID_ENV, dependencies)).rejects.toHaveProperty(
      'message',
      'Redis readiness check failed'
    )
    expect(postgres.end).toHaveBeenCalledOnce()
    expect(redis.destroy).toHaveBeenCalledOnce()
  })

  it('ignores synchronous cleanup failures without masking readiness or skipping cleanup', async () => {
    const { postgres, redis, dependencies } = serviceDoubles()
    redis.ping.mockRejectedValue(new Error('private readiness marker'))
    redis.destroy.mockImplementation(() => {
      throw new Error('private Redis cleanup marker')
    })
    postgres.end.mockImplementation(() => {
      throw new Error('private PostgreSQL cleanup marker')
    })

    await expect(verifyCiServices(VALID_ENV, dependencies)).rejects.toHaveProperty(
      'message',
      'Redis readiness check failed'
    )
    expect(redis.destroy).toHaveBeenCalledOnce()
    expect(postgres.end).toHaveBeenCalledOnce()
  })

  it('observes and ignores asynchronous cleanup failures after successful readiness', async () => {
    const { postgres, redis, dependencies } = serviceDoubles()
    let redisCleanupObserved = false
    redis.destroy.mockImplementation(() => ({
      then(_resolve, reject) {
        redisCleanupObserved = true
        reject(new Error('private Redis cleanup marker'))
      }
    }))
    postgres.end.mockRejectedValue(new Error('private PostgreSQL cleanup marker'))

    await expect(verifyCiServices(VALID_ENV, dependencies)).resolves.toBeUndefined()
    expect(redisCleanupObserved).toBe(true)
    expect(redis.destroy).toHaveBeenCalledOnce()
    expect(postgres.end).toHaveBeenCalledOnce()
  })

  it('keeps the archived reference cookie nonfunctional', async () => {
    const source = await readFile(new URL('../archive/reference/uxdy-scheduleofclasses-scrape.ts', import.meta.url), 'utf8')

    expect(source.includes("const cookie = 'REDACTED_ARCHIVED_SESSION_COOKIE'")).toBe(true)
    expect(source.includes('jlinksessionidx=')).toBe(false)
    expect(source.includes('itscookie=')).toBe(false)
    expect(source.includes('TS01111c3f=')).toBe(false)
  })

  it('defines loopback PostgreSQL and Redis services with bounded health checks', async () => {
    const source = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8')

    expect(source.includes('redis:\n    image: redis:7-alpine')).toBe(true)
    expect(source.includes('ports: ["127.0.0.1:6379:6379"]')).toBe(true)
    expect(source.includes('pg_isready')).toBe(true)
    expect(source.includes('redis-cli')).toBe(true)
    expect(source.match(/healthcheck:/g)?.length).toBe(2)
    expect(source.includes('command: ["redis-server", "--save", "", "--appendonly", "no"]')).toBe(true)
  })
})
