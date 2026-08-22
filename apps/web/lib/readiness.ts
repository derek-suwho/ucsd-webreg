import { createClient } from 'redis'
import { requireProductionDatabaseUrl } from '@webreg/config'
import { PrismaClient } from '@webreg/db'

const DEFAULT_TIMEOUT_MS = 2_000
const REDIS_CONNECT_TIMEOUT_MS = 1_500
const DATABASE_TIMEOUT_SECONDS = '1'

let activeDependencyProbe: Promise<void> | undefined
let readinessPrisma: PrismaClient | undefined

function clearActiveProbe(probe: Promise<void>): void {
  if (activeDependencyProbe === probe) activeDependencyProbe = undefined
}

export interface ReadinessDependencies {
  checkDatabase?: () => Promise<unknown>
  checkRedis?: () => Promise<unknown>
  timeoutMs?: number
}

async function withinTimeout(operation: () => Promise<unknown>, timeoutMs: number): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('readiness probe timed out')), timeoutMs)
    timeout.unref?.()
  })
  try {
    await Promise.race([operation(), deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export function buildReadinessDatabaseUrl(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV
): string {
  if (!databaseUrl) throw new Error('Database is not configured')
  const url = new URL(nodeEnv === 'production'
    ? requireProductionDatabaseUrl(databaseUrl)
    : databaseUrl)
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('Database URL is not PostgreSQL')
  }
  url.searchParams.set('connection_limit', '1')
  url.searchParams.set('connect_timeout', DATABASE_TIMEOUT_SECONDS)
  url.searchParams.set('pool_timeout', DATABASE_TIMEOUT_SECONDS)
  url.searchParams.set('socket_timeout', DATABASE_TIMEOUT_SECONDS)
  return url.href
}

function getReadinessPrisma(): PrismaClient {
  readinessPrisma ??= new PrismaClient({
    datasourceUrl: buildReadinessDatabaseUrl(process.env.DATABASE_URL)
  })
  return readinessPrisma
}

async function checkDatabase(): Promise<void> {
  await getReadinessPrisma().$queryRaw`SELECT 1`
}

async function checkRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) throw new Error('Redis is not configured')

  const client = createClient({
    url: redisUrl,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      socketTimeout: REDIS_CONNECT_TIMEOUT_MS,
      reconnectStrategy: false
    }
  })
  client.on('error', () => undefined)
  try {
    await client.connect()
    await client.ping()
  } finally {
    if (client.isOpen) {
      await client.quit().catch(() => client.destroy())
    } else {
      client.destroy()
    }
  }
}

export async function checkReadiness(
  dependencies: ReadinessDependencies = {}
): Promise<boolean> {
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return false

  try {
    if (!activeDependencyProbe) {
      const probe = Promise.allSettled([
        Promise.resolve().then(dependencies.checkDatabase ?? checkDatabase),
        Promise.resolve().then(dependencies.checkRedis ?? checkRedis)
      ]).then(results => {
        if (results.some(result => result.status === 'rejected')) {
          throw new Error('readiness dependency unavailable')
        }
      })
      activeDependencyProbe = probe
      void probe.then(
        () => clearActiveProbe(probe),
        () => clearActiveProbe(probe)
      )
    }
    await withinTimeout(() => activeDependencyProbe!, timeoutMs)
    return true
  } catch {
    return false
  }
}
