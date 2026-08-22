import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryRateLimitStore,
  RateLimitUnavailableError,
  checkRateLimit,
  rateLimitResponse,
  setRedisClientFactoryForTests,
  setRateLimitStoreForTests
} from './rate-limit'

describe('checkRateLimit', () => {
  afterEach(() => {
    setRateLimitStoreForTests(undefined)
    setRedisClientFactoryForTests(undefined)
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('allows exactly the configured number of requests', async () => {
    const store = new InMemoryRateLimitStore(() => 0)

    await expect(checkRateLimit({ bucket: 'terms', key: '198.51.100.1', limit: 2, windowSeconds: 60 }, { store }))
      .resolves.toMatchObject({ allowed: true })
    await expect(checkRateLimit({ bucket: 'terms', key: '198.51.100.1', limit: 2, windowSeconds: 60 }, { store }))
      .resolves.toMatchObject({ allowed: true })
    await expect(checkRateLimit({ bucket: 'terms', key: '198.51.100.1', limit: 2, windowSeconds: 60 }, { store }))
      .resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 })
  })

  it('keeps bucket and subject keys independent', async () => {
    const store = new InMemoryRateLimitStore(() => 0)
    const options = { limit: 1, windowSeconds: 60 }

    await checkRateLimit({ ...options, bucket: 'catalog', key: '198.51.100.1' }, { store })

    await expect(checkRateLimit({ ...options, bucket: 'health', key: '198.51.100.1' }, { store }))
      .resolves.toMatchObject({ allowed: true })
    await expect(checkRateLimit({ ...options, bucket: 'catalog', key: '198.51.100.2' }, { store }))
      .resolves.toMatchObject({ allowed: true })
  })

  it('starts a fresh counter after the fixed window expires', async () => {
    let now = 0
    const store = new InMemoryRateLimitStore(() => now)
    const options = { bucket: 'auth', key: '198.51.100.1', limit: 1, windowSeconds: 10 }

    await checkRateLimit(options, { store })
    now = 9_000
    await expect(checkRateLimit(options, { store }))
      .resolves.toMatchObject({ allowed: false, retryAfterSeconds: 1 })
    now = 10_000
    await expect(checkRateLimit(options, { store }))
      .resolves.toMatchObject({ allowed: true, retryAfterSeconds: 10 })
  })

  it('fails closed when the backing store errors', async () => {
    const store = {
      increment: async () => {
        throw new Error('redis unavailable')
      }
    }

    await expect(checkRateLimit(
      { bucket: 'terms', key: '198.51.100.1', limit: 1, windowSeconds: 60 },
      { store }
    )).rejects.toBeInstanceOf(RateLimitUnavailableError)
  })

  it('supports a deterministic process store in tests', async () => {
    const store = new InMemoryRateLimitStore(() => 0)
    setRateLimitStoreForTests(store)

    await checkRateLimit({ bucket: 'injected', key: 'user-1', limit: 1, windowSeconds: 60 })
    await expect(checkRateLimit({
      bucket: 'injected',
      key: 'user-1',
      limit: 1,
      windowSeconds: 60
    })).resolves.toMatchObject({ allowed: false })

    setRateLimitStoreForTests(undefined)
  })

  it('clamps a zero-millisecond Redis PTTL to one Retry-After second', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn().mockResolvedValue([2, 0]),
      on: vi.fn()
    }
    setRedisClientFactoryForTests(() => client)

    await expect(checkRateLimit({
      bucket: 'catalog',
      key: '198.51.100.1',
      limit: 1,
      windowSeconds: 60
    })).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 1
    })
    expect(client.eval.mock.calls[0]?.[0]).toContain("redis.call('PTTL'")
  })

  it('bounds Redis connections, logs errors generically, and retries failed initialization', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const errorListeners: Array<(error: Error) => void> = []
    const failedClient = {
      connect: vi.fn().mockRejectedValue(new Error('secret redis endpoint')),
      eval: vi.fn(),
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener)
      })
    }
    const recoveredClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn().mockResolvedValue([1, 60_000]),
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') errorListeners.push(listener)
      })
    }
    const clients = [failedClient, recoveredClient]
    const options: unknown[] = []
    setRedisClientFactoryForTests(clientOptions => {
      options.push(clientOptions)
      return clients.shift()!
    })

    await expect(checkRateLimit({
      bucket: 'health',
      key: '198.51.100.1',
      limit: 1,
      windowSeconds: 60
    })).rejects.toBeInstanceOf(RateLimitUnavailableError)
    await expect(checkRateLimit({
      bucket: 'health',
      key: '198.51.100.1',
      limit: 1,
      windowSeconds: 60
    })).resolves.toMatchObject({ allowed: true })

    expect(failedClient.connect).toHaveBeenCalledOnce()
    expect(recoveredClient.connect).toHaveBeenCalledOnce()
    expect(options[0]).toMatchObject({
      disableOfflineQueue: true,
      socket: { connectTimeout: 2_000, reconnectStrategy: expect.any(Function) }
    })
    const reconnectStrategy = (options[0] as {
      socket: { reconnectStrategy: (retries: number) => number | false }
    }).socket.reconnectStrategy
    expect(reconnectStrategy(0)).toBeTypeOf('number')
    expect(reconnectStrategy(3)).toBe(false)

    errorListeners[0]?.(new Error('redis://user:password@private-host'))
    expect(log).toHaveBeenCalledWith('Redis rate-limit client error')
  })

  it('creates a fresh Redis store after a connected client exhausts reconnects', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const firstClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn()
        .mockResolvedValueOnce([1, 60_000])
        .mockRejectedValue(new Error('closed client')),
      on: vi.fn()
    }
    const recoveredClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn().mockResolvedValue([1, 60_000]),
      on: vi.fn()
    }
    const clients = [firstClient, recoveredClient]
    const options: Array<{
      socket?: { reconnectStrategy?: (retries: number) => number | false }
    }> = []
    const factory = vi.fn(clientOptions => {
      options.push(clientOptions)
      return clients.shift()!
    })
    setRedisClientFactoryForTests(factory)
    const limit = {
      bucket: 'terms',
      key: '198.51.100.1',
      limit: 2,
      windowSeconds: 60
    }

    await expect(checkRateLimit(limit)).resolves.toMatchObject({ allowed: true })
    expect(options[0]?.socket?.reconnectStrategy?.(3)).toBe(false)
    await expect(checkRateLimit(limit)).resolves.toMatchObject({ allowed: true })

    expect(factory).toHaveBeenCalledTimes(2)
    expect(firstClient.connect).toHaveBeenCalledOnce()
    expect(recoveredClient.connect).toHaveBeenCalledOnce()
  })
})

describe('rateLimitResponse', () => {
  it('returns 429 with a whole-second Retry-After header', async () => {
    const response = rateLimitResponse(2.1)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3')
    await expect(response.json()).resolves.toEqual({ error: 'too many requests' })
  })
})
