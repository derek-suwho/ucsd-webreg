import { describe, expect, it, vi } from 'vitest'
import {
  withCatalogLock,
  type CatalogLockClient,
  type CatalogLockDependencies
} from './catalog-lock.js'

type QueryResult = { rows: Array<Record<string, boolean>> }

function clientWith(
  query: CatalogLockClient['query'],
  overrides: Partial<CatalogLockClient> = {}
): CatalogLockClient {
  return {
    connect: vi.fn(async () => {}),
    query,
    end: vi.fn(async () => {}),
    ...overrides
  }
}

function dependencies(client: CatalogLockClient): CatalogLockDependencies {
  return {
    databaseUrl: 'postgresql://database.example/webreg',
    createClient: vi.fn(() => client)
  }
}

describe('withCatalogLock', () => {
  it('acquires and releases the term catalog-write lock with parameterized queries', async () => {
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] } as QueryResult)
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] } as QueryResult)
    const client = clientWith(query)
    const deps = dependencies(client)

    await expect(withCatalogLock('FA26', async () => 'done', deps)).resolves.toEqual({
      acquired: true,
      value: 'done'
    })

    expect(deps.createClient).toHaveBeenCalledWith({
      connectionString: 'postgresql://database.example/webreg'
    })
    expect(query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired',
      ['catalog-write', 'FA26']
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      'SELECT pg_advisory_unlock(hashtext($1), hashtext($2)) AS unlocked',
      ['catalog-write', 'FA26']
    )
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('uses explicit CA and hostname verification with the shared production Prisma URL', async () => {
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: false }] } as QueryResult)
    const client = clientWith(query)
    const createClient = vi.fn(() => client)

    await expect(withCatalogLock('FA26', async () => undefined, {
      databaseUrl:
        'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict&application_name=catalog-worker',
      nodeEnv: 'production',
      createClient
    })).resolves.toEqual({ acquired: false })

    expect(createClient).toHaveBeenCalledWith({
      connectionString:
        'postgresql://web_runtime:secret@db.example.com:5432/webreg?application_name=catalog-worker',
      ssl: { rejectUnauthorized: true }
    })
  })

  it.each([
    ['Prisma verify-full',
      'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=verify-full&sslaccept=strict'],
    ['pg certificate bypass',
      'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict&ssl=no-verify'],
    ['pg TLS disable',
      'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict&ssl=0'],
    ['duplicate pg TLS override',
      'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict&ssl=true&ssl=no-verify']
  ])('rejects %s before constructing a production pg client', async (_case, databaseUrl) => {
    const createClient = vi.fn(() => clientWith(vi.fn()))

    await expect(withCatalogLock('FA26', async () => undefined, {
      databaseUrl,
      nodeEnv: 'production',
      createClient
    })).rejects.toThrow('Catalog lock configuration failed')

    expect(createClient).not.toHaveBeenCalled()
  })

  it('returns an unacquired result without running or queueing the operation', async () => {
    const operation = vi.fn(async () => 'not run')
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: false }] } as QueryResult)
    const client = clientWith(query)

    await expect(withCatalogLock('FA26', operation, dependencies(client))).resolves.toEqual({
      acquired: false
    })

    expect(operation).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledOnce()
    expect(client.end).toHaveBeenCalledOnce()
  })

  it.each([
    ['empty rows', []],
    ['missing acquired field', [{}]],
    ['non-boolean acquired field', [{ acquired: 'false' }]]
  ])('rejects %s as a sanitized acquisition failure', async (_case, rows) => {
    const client = clientWith(vi.fn(async () => ({ rows })))

    await expect(withCatalogLock('FA26', async () => {}, dependencies(client))).rejects.toThrow(
      'Catalog lock acquisition failed'
    )

    expect(client.end).toHaveBeenCalledOnce()
  })

  it('releases and closes after the operation throws, then preserves the operation error', async () => {
    const failure = new Error('sync failed')
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] } as QueryResult)
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] } as QueryResult)
    const client = clientWith(query)

    await expect(
      withCatalogLock(
        'FA26',
        async () => {
          throw failure
        },
        dependencies(client)
      )
    ).rejects.toBe(failure)

    expect(query).toHaveBeenCalledTimes(2)
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('attempts close after connection setup fails and exposes no connection details', async () => {
    const client = clientWith(vi.fn(), {
      connect: vi.fn(async () => {
        throw new Error('password=secret at postgresql://user:secret@database.example/webreg')
      })
    })

    await expect(withCatalogLock('FA26', async () => {}, dependencies(client))).rejects.toThrow(
      'Catalog lock connection failed'
    )

    expect(client.query).not.toHaveBeenCalled()
    expect(client.end).toHaveBeenCalledOnce()
  })

  it('sanitizes client-construction failures that may contain the connection string', async () => {
    const createClient = vi.fn(() => {
      throw new Error('invalid postgresql://user:secret@database.example/webreg')
    })

    await expect(
      withCatalogLock('FA26', async () => {}, {
        databaseUrl: 'postgresql://user:secret@database.example/webreg',
        createClient
      })
    ).rejects.toThrow('Catalog lock connection failed')
  })

  it('still closes and returns the operation value when unlock fails', async () => {
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] } as QueryResult)
      .mockRejectedValueOnce(new Error('unlock failed'))
    const client = clientWith(query)

    await expect(withCatalogLock('FA26', async () => 42, dependencies(client))).resolves.toEqual({
      acquired: true,
      value: 42
    })

    expect(client.end).toHaveBeenCalledOnce()
  })

  it('attempts close when unlock fails after an operation error', async () => {
    const failure = new Error('operation failed')
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] } as QueryResult)
      .mockRejectedValueOnce(new Error('unlock failed'))
    const client = clientWith(query)

    await expect(
      withCatalogLock(
        'FA26',
        async () => {
          throw failure
        },
        dependencies(client)
      )
    ).rejects.toBe(failure)

    expect(client.end).toHaveBeenCalledOnce()
  })

  it('does not let close failure replace an operation error', async () => {
    const failure = new Error('operation failed')
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] } as QueryResult)
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] } as QueryResult)
    const client = clientWith(query, {
      end: vi.fn(async () => {
        throw new Error('close failed')
      })
    })

    await expect(
      withCatalogLock(
        'FA26',
        async () => {
          throw failure
        },
        dependencies(client)
      )
    ).rejects.toBe(failure)
  })

  it('reports a generic cleanup failure when close fails after success', async () => {
    const query = vi
      .fn<CatalogLockClient['query']>()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] } as QueryResult)
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] } as QueryResult)
    const client = clientWith(query, {
      end: vi.fn(async () => {
        throw new Error('password=secret at postgresql://user:secret@database.example/webreg')
      })
    })

    await expect(withCatalogLock('FA26', async () => 'done', dependencies(client))).rejects.toThrow(
      'Catalog lock cleanup failed'
    )
  })
})

describe.skipIf(!process.env.DATABASE_URL)('withCatalogLock PostgreSQL concurrency', () => {
  it('makes independent catalog-writing sessions for one term contend without queueing', async () => {
    let markFirstStarted!: () => void
    const firstStarted = new Promise<void>(resolve => {
      markFirstStarted = resolve
    })
    let releaseFirst!: () => void
    const holdFirst = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    const firstOperation = vi.fn(async () => {
      markFirstStarted()
      await holdFirst
      return 'full-sync'
    })
    const secondOperation = vi.fn(async () => 'seat-refresh')
    const termId = `SEC10_LOCK_TEST_${process.pid}_${Date.now()}`

    const firstRunner = withCatalogLock(termId, firstOperation)
    await Promise.race([
      firstStarted,
      firstRunner.then(() => {
        throw new Error('First lock operation completed before release')
      })
    ])

    try {
      await expect(withCatalogLock(termId, secondOperation)).resolves.toEqual({
        acquired: false
      })
      expect(secondOperation).not.toHaveBeenCalled()
    } finally {
      releaseFirst()
    }
    await expect(firstRunner).resolves.toEqual({
      acquired: true,
      value: 'full-sync'
    })
    expect(firstOperation).toHaveBeenCalledOnce()
  })
})
