import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
import { createClient } from 'redis'

const DEFAULT_TIMEOUT_MS = 5_000

function requiredServiceUrl(environment, name, protocols) {
  const value = environment[name]
  if (!value?.trim()) throw new Error(`${name} is required`)

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} is invalid`)
  }
  if (!protocols.includes(url.protocol)) throw new Error(`${name} is invalid`)
  return value
}

async function withinTimeout(operation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('service check timed out')), timeoutMs)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function ignoreCleanupFailure(operation, timeoutMs) {
  try {
    await withinTimeout(Promise.resolve().then(operation), timeoutMs)
  } catch {
    // Readiness failure is authoritative; cleanup must not mask or hang it.
  }
}

export async function verifyCiServices(environment = process.env, dependencies = {}) {
  const databaseUrl = requiredServiceUrl(environment, 'DATABASE_URL', ['postgres:', 'postgresql:'])
  const redisUrl = requiredServiceUrl(environment, 'REDIS_URL', ['redis:', 'rediss:'])
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const createPostgresClient = dependencies.createPostgresClient ?? (options => new pg.Client(options))
  const createRedisClient = dependencies.createRedisClient ?? (options => createClient(options))

  const postgres = createPostgresClient({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs
  })
  let redis
  try {
    try {
      await withinTimeout(postgres.connect(), timeoutMs)
      const result = await withinTimeout(postgres.query('SELECT 1 AS ready'), timeoutMs)
      if (result?.rows?.[0]?.ready !== 1) throw new Error('unexpected PostgreSQL response')
    } catch {
      throw new Error('PostgreSQL readiness check failed')
    }

    redis = createRedisClient({
      url: redisUrl,
      socket: { connectTimeout: timeoutMs, reconnectStrategy: false }
    })
    redis.on('error', () => {})
    try {
      await withinTimeout(redis.connect(), timeoutMs)
      const response = await withinTimeout(redis.ping(), timeoutMs)
      if (response !== 'PONG') throw new Error('unexpected Redis response')
    } catch {
      throw new Error('Redis readiness check failed')
    }
  } finally {
    if (redis?.isOpen) await ignoreCleanupFailure(() => redis.destroy(), timeoutMs)
    await ignoreCleanupFailure(() => postgres.end(), timeoutMs)
  }
}

async function main() {
  await verifyCiServices()
  process.stdout.write('PostgreSQL and Redis are ready\n')
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (entryUrl === import.meta.url) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'CI service verification failed'}\n`)
    process.exitCode = 1
  })
}
