import { createClient } from 'redis'

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }>
}

export interface RateLimitOptions {
  bucket: string
  key: string
  limit: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  remaining: number
}

export class RateLimitUnavailableError extends Error {
  constructor() {
    super('Rate limit store unavailable')
    this.name = 'RateLimitUnavailableError'
  }
}

interface Counter {
  count: number
  expiresAt: number
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000
  ) {}

  async increment(key: string, windowSeconds: number) {
    const now = this.now()
    const existing = this.counters.get(key)
    if (existing && existing.expiresAt > now) {
      existing.count += 1
      return {
        count: existing.count,
        ttlSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1_000))
      }
    }

    if (existing) {
      this.counters.delete(key)
    }
    if (this.counters.size >= this.maxEntries) {
      for (const [entryKey, counter] of this.counters) {
        if (counter.expiresAt <= now) this.counters.delete(entryKey)
      }
    }
    if (this.counters.size >= this.maxEntries) {
      throw new Error('In-memory rate limit store capacity exceeded')
    }

    this.counters.set(key, {
      count: 1,
      expiresAt: now + windowSeconds * 1_000
    })
    return { count: 1, ttlSeconds: windowSeconds }
  }
}

const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return { count, pttl }
`

interface RedisClient {
  connect(): Promise<unknown>
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>
  on(event: 'error', listener: (error: Error) => void): unknown
}

type RedisClientFactory = (options: Parameters<typeof createClient>[0]) => RedisClient

class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisClient) {}

  async increment(key: string, windowSeconds: number) {
    const result = await this.client.eval(INCREMENT_WITH_EXPIRY, {
      keys: [key],
      arguments: [String(windowSeconds)]
    })
    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error('Unexpected Redis rate limit response')
    }

    const count = Number(result[0])
    const ttlMilliseconds = Number(result[1])
    if (
      !Number.isSafeInteger(count)
      || count < 1
      || !Number.isSafeInteger(ttlMilliseconds)
      || ttlMilliseconds < 0
    ) {
      throw new Error('Invalid Redis rate limit response')
    }
    return {
      count,
      ttlSeconds: Math.max(1, Math.ceil(ttlMilliseconds / 1_000))
    }
  }
}

const REDIS_CONNECT_TIMEOUT_MS = 2_000
const REDIS_MAX_RECONNECT_ATTEMPTS = 3

let redisStorePromise: Promise<RateLimitStore> | undefined
let redisStoreGeneration = 0
let developmentStore: RateLimitStore | undefined
let injectedTestStore: RateLimitStore | undefined
const defaultRedisClientFactory: RedisClientFactory = options => createClient(options) as RedisClient
let redisClientFactory = defaultRedisClientFactory
let warnedAboutDevelopmentFallback = false

export function setRateLimitStoreForTests(store: RateLimitStore | undefined) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Test rate limit stores may only be injected when NODE_ENV=test')
  }
  injectedTestStore = store
}

export function setRedisClientFactoryForTests(factory: RedisClientFactory | undefined) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Test Redis client factories may only be injected when NODE_ENV=test')
  }
  redisClientFactory = factory ?? defaultRedisClientFactory
  redisStoreGeneration += 1
  redisStorePromise = undefined
}

async function initializeRedisStore(
  redisUrl: string,
  onReconnectExhausted: () => void
): Promise<RateLimitStore> {
  const client = redisClientFactory({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: retries => {
        if (retries >= REDIS_MAX_RECONNECT_ATTEMPTS) {
          onReconnectExhausted()
          return false
        }
        return Math.min(100 * 2 ** retries, 1_000)
      }
    }
  })
  client.on('error', () => {
    console.error('Redis rate-limit client error')
  })
  await client.connect()
  return new RedisRateLimitStore(client)
}

function redisStore(redisUrl: string): Promise<RateLimitStore> {
  if (!redisStorePromise) {
    const generation = ++redisStoreGeneration
    const clearCurrentStore = () => {
      if (redisStoreGeneration === generation) {
        redisStorePromise = undefined
      }
    }
    const initialization = initializeRedisStore(redisUrl, clearCurrentStore)
    redisStorePromise = initialization
    void initialization.catch(() => {
      clearCurrentStore()
    })
  }
  return redisStorePromise
}

async function defaultStore(): Promise<RateLimitStore> {
  if (injectedTestStore) return injectedTestStore

  const redisUrl = process.env.REDIS_URL
  if (redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      try {
        if (new URL(redisUrl).protocol !== 'rediss:') {
          throw new RateLimitUnavailableError()
        }
      } catch {
        throw new RateLimitUnavailableError()
      }
    }
    return redisStore(redisUrl)
  }

  if (process.env.NODE_ENV === 'production') {
    throw new RateLimitUnavailableError()
  }
  if (!warnedAboutDevelopmentFallback) {
    console.warn('REDIS_URL is absent; using bounded process-local rate limiting outside production')
    warnedAboutDevelopmentFallback = true
  }
  developmentStore ??= new InMemoryRateLimitStore()
  return developmentStore
}

function validPositiveInteger(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

export async function checkRateLimit(
  options: RateLimitOptions,
  dependencies: { store?: RateLimitStore } = {}
): Promise<RateLimitResult> {
  if (
    !options.bucket ||
    !options.key ||
    !validPositiveInteger(options.limit) ||
    !validPositiveInteger(options.windowSeconds)
  ) {
    throw new TypeError('Invalid rate limit options')
  }

  try {
    const store = dependencies.store ?? await defaultStore()
    const { count, ttlSeconds } = await store.increment(
      `webreg:rate-limit:${options.bucket}:${options.key}`,
      options.windowSeconds
    )
    return {
      allowed: count <= options.limit,
      retryAfterSeconds: Math.max(1, ttlSeconds),
      remaining: Math.max(0, options.limit - count)
    }
  } catch {
    throw new RateLimitUnavailableError()
  }
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return Response.json(
    { error: 'too many requests' },
    {
      status: 429,
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) }
    }
  )
}
