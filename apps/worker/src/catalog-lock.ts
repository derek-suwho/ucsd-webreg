import { Client } from 'pg'
import { buildPgConnectionConfig, type PgConnectionConfig } from '@webreg/config'

const LOCK_NAMESPACE = 'catalog-write'
const ACQUIRE_SQL =
  'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired'
const RELEASE_SQL =
  'SELECT pg_advisory_unlock(hashtext($1), hashtext($2)) AS unlocked'

export interface CatalogLockClient {
  connect(): Promise<unknown>
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
  end(): Promise<void>
}

export interface CatalogLockDependencies {
  databaseUrl?: string
  nodeEnv?: string
  createClient?: (config: PgConnectionConfig) => CatalogLockClient
}

const defaultCreateClient = (config: PgConnectionConfig): CatalogLockClient =>
  new Client(config)

/**
 * Runs one term-scoped catalog mutation while holding a session-level PostgreSQL advisory lock.
 * A busy lock returns immediately; it never waits or queues.
 */
export async function withCatalogLock<T>(
  termId: string,
  operation: () => Promise<T>,
  deps: CatalogLockDependencies = {}
): Promise<{ acquired: boolean; value?: T }> {
  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('Catalog lock configuration failed')

  let clientConfig: PgConnectionConfig
  try {
    clientConfig = buildPgConnectionConfig(databaseUrl, deps.nodeEnv ?? process.env.NODE_ENV)
  } catch {
    throw new Error('Catalog lock configuration failed')
  }

  const createClient = deps.createClient ?? defaultCreateClient
  let client: CatalogLockClient | undefined
  let acquired = false
  let primaryError: unknown

  try {
    try {
      client = createClient(clientConfig)
    } catch {
      throw new Error('Catalog lock connection failed')
    }

    try {
      await client.connect()
    } catch {
      throw new Error('Catalog lock connection failed')
    }

    let acquisitionValue: boolean
    try {
      const result = await client.query(ACQUIRE_SQL, [LOCK_NAMESPACE, termId])
      const value = result.rows[0]?.acquired
      if (typeof value !== 'boolean') {
        throw new Error('Invalid catalog lock acquisition response')
      }
      acquisitionValue = value
    } catch {
      throw new Error('Catalog lock acquisition failed')
    }

    acquired = acquisitionValue
    if (!acquired) return { acquired: false }

    return { acquired: true, value: await operation() }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (client && acquired) {
      try {
        await client.query(RELEASE_SQL, [LOCK_NAMESPACE, termId])
      } catch {
        // Closing the dedicated session below releases any remaining session-level lock.
      }
    }

    if (client) {
      try {
        await client.end()
      } catch {
        if (primaryError === undefined) {
          throw new Error('Catalog lock cleanup failed')
        }
      }
    }
  }
}
