import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogSource } from '@webreg/catalog'
import {
  createDefaultWorker,
  reportWorkerStartupFailure,
  runWorkerEntrypoint,
  startWorker,
  type WorkerHandle
} from './index.js'

function source(kind: CatalogSource['kind']): CatalogSource {
  return {
    kind,
    knownTermIds: [],
    listTerms: vi.fn(async () => []),
    fetchDepartment: vi.fn(async () => [])
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('startWorker', () => {
  it('imports fixture exactly once, schedules no recurring catalog work, and disconnects once', async () => {
    vi.useFakeTimers()
    const sync = vi.fn(async () => {})
    const disconnect = vi.fn(async () => {})
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const worker = await startWorker({ source: source('fixture'), sync, disconnect })
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    await worker.stop()
    await worker.stop()

    expect(sync).toHaveBeenCalledOnce()
    expect(setIntervalSpy).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('clears both legacy intervals, prevents new ticks, waits active work, and closes once', async () => {
    vi.useFakeTimers()
    const active = deferred()
    const sync = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => active.promise)
    const seatRefresh = vi.fn(async () => {})
    const closeResources = vi.fn(async () => {})
    const disconnect = vi.fn(async () => {})
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const worker = await startWorker({
      source: source('legacy-soc'),
      sync,
      seatRefresh,
      fullSyncIntervalMs: 100,
      seatRefreshIntervalMs: 200,
      closeResources,
      disconnect
    })

    await vi.advanceTimersByTimeAsync(100)
    const stopping = worker.stop()
    await Promise.resolve()
    expect(closeResources).not.toHaveBeenCalled()
    active.resolve()
    await stopping
    await vi.advanceTimersByTimeAsync(1_000)
    await worker.stop()

    expect(clearIntervalSpy).toHaveBeenCalledTimes(2)
    expect(sync).toHaveBeenCalledTimes(2)
    expect(seatRefresh).not.toHaveBeenCalled()
    expect(closeResources).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('runs both non-overlapping legacy schedules', async () => {
    vi.useFakeTimers()
    const sync = vi.fn(async () => {})
    const seatRefresh = vi.fn(async () => {})
    const worker = await startWorker({
      source: source('legacy-soc'), sync, seatRefresh,
      fullSyncIntervalMs: 100, seatRefreshIntervalMs: 150,
      disconnect: vi.fn(async () => {})
    })

    await vi.advanceTimersByTimeAsync(300)
    await worker.stop()

    expect(sync).toHaveBeenCalledTimes(4)
    expect(seatRefresh).toHaveBeenCalledTimes(2)
  })

  it('skips an overlapping tick of the same job', async () => {
    vi.useFakeTimers()
    const active = deferred()
    const sync = vi.fn().mockResolvedValueOnce(undefined).mockReturnValue(active.promise)
    const worker = await startWorker({
      source: source('legacy-soc'), sync,
      fullSyncIntervalMs: 10, seatRefreshIntervalMs: 1_000,
      shutdownTimeoutMs: 1, disconnect: vi.fn(async () => {}),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await vi.advanceTimersByTimeAsync(20)
    expect(sync).toHaveBeenCalledTimes(2)
    active.resolve()
    await vi.advanceTimersByTimeAsync(1)
    await worker.stop()
  })

  it('attempts Prisma disconnect when resource cleanup fails', async () => {
    const failure = new Error('cleanup failed')
    const disconnect = vi.fn(async () => {})
    const worker = await startWorker({
      source: source('fixture'), sync: vi.fn(async () => {}),
      closeResources: vi.fn(async () => { throw failure }), disconnect
    })
    await expect(worker.stop()).rejects.toBe(failure)
    await expect(worker.stop()).rejects.toBe(failure)
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('closes startup resources and preserves the fatal startup error', async () => {
    const failure = new Error('private startup failure')
    const closeResources = vi.fn(async () => {})
    const disconnect = vi.fn(async () => {})
    await expect(startWorker({
      source: source('fixture'),
      sync: vi.fn(async () => { throw failure }),
      closeResources,
      disconnect
    })).rejects.toBe(failure)
    expect(closeResources).toHaveBeenCalledOnce()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('bounds shutdown wait before closing resources', async () => {
    vi.useFakeTimers()
    const never = new Promise<void>(() => {})
    const sync = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(never)
    const closeResources = vi.fn(async () => {})
    const worker = await startWorker({
      source: source('legacy-soc'), sync,
      fullSyncIntervalMs: 10, seatRefreshIntervalMs: 1_000,
      shutdownTimeoutMs: 50, closeResources,
      disconnect: vi.fn(async () => {})
    })
    await vi.advanceTimersByTimeAsync(10)

    const stopping = worker.stop()
    await vi.advanceTimersByTimeAsync(49)
    expect(closeResources).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await stopping

    expect(closeResources).toHaveBeenCalledOnce()
  })

  it('does not install process signal handlers from the library API', async () => {
    const once = vi.spyOn(process, 'once')
    const worker = await startWorker({
      source: source('fixture'), sync: vi.fn(async () => {}), disconnect: vi.fn(async () => {})
    })
    await worker.stop()
    expect(once).not.toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    expect(once).not.toHaveBeenCalledWith('SIGINT', expect.any(Function))
  })
})

it('selects the production fixture source without network bootstrap', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const start = vi.fn(async () => ({ stop: async () => {} }))
  await createDefaultWorker({
    DATABASE_URL:
      'postgresql://web_runtime:secret@example.invalid/catalog?sslmode=require&sslaccept=strict',
    CONTACT_EMAIL: 'ops@example.com',
    CATALOG_SOURCE: 'fixture'
  }, 'production', { start })

  expect(start).toHaveBeenCalledOnce()
  expect(start.mock.calls[0][0].source.kind).toBe('fixture')
  expect(start.mock.calls[0][0].seatRefresh).toBeUndefined()
  expect(fetchSpy).not.toHaveBeenCalled()
})

it('threads configured snapshot limits into legacy seat refresh', async () => {
  const refreshSeats = vi.fn(async () => {})
  const start = vi.fn(async (dependencies: Parameters<typeof startWorker>[0]) => {
    await dependencies.seatRefresh?.()
    return { stop: async () => {} }
  })
  await createDefaultWorker({
    DATABASE_URL: 'postgresql://example.invalid/catalog',
    CONTACT_EMAIL: 'ops@example.com',
    CATALOG_SOURCE: 'legacy-soc',
    CATALOG_MAX_COURSES: '7',
    CATALOG_MAX_SECTIONS: '8',
    CATALOG_MAX_SNAPSHOT_BYTES: '9000'
  }, 'development', {
    createSource: () => ({
      kind: 'legacy-soc', listTerms: async () => [], fetchDepartment: async () => [], refreshSeats
    }),
    start
  })

  expect(refreshSeats).toHaveBeenCalledWith({
    snapshotLimits: { maxCourses: 7, maxSections: 8, maxSerializedBytes: 9000 }
  })
})

it('sanitizes startup failures', () => {
  const error = new Error('postgresql://user:password@example private-session')
  const log = { error: vi.fn() }
  reportWorkerStartupFailure(error, log)
  expect(log.error).toHaveBeenCalledWith(
    { category: 'worker_operation_failed' },
    'worker failed to start'
  )
  expect(JSON.stringify(log.error.mock.calls)).not.toContain(error.message)
})

it('honors a termination signal received before initial sync finishes', async () => {
  const signalTarget = new EventEmitter()
  const startup = deferred()
  const stop = vi.fn(async () => {})
  const setFailed = vi.fn()
  const running = runWorkerEntrypoint(
    async () => {
      await startup.promise
      return { stop } satisfies WorkerHandle
    },
    signalTarget,
    setFailed
  )

  signalTarget.emit('SIGTERM')
  expect(stop).not.toHaveBeenCalled()
  startup.resolve()
  await running

  expect(stop).toHaveBeenCalledOnce()
  expect(setFailed).not.toHaveBeenCalled()
})

it('keeps both signal handlers through cleanup and reuses one stop promise', async () => {
  const signalTarget = new EventEmitter()
  const cleanup = deferred()
  const stop = vi.fn(() => cleanup.promise)
  await runWorkerEntrypoint(
    async () => ({ stop }),
    signalTarget
  )

  signalTarget.emit('SIGTERM')
  signalTarget.emit('SIGINT')
  signalTarget.emit('SIGTERM')
  expect(stop).toHaveBeenCalledOnce()
  expect(signalTarget.listenerCount('SIGTERM')).toBe(1)
  expect(signalTarget.listenerCount('SIGINT')).toBe(1)

  cleanup.resolve()
  await vi.waitFor(() => {
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0)
    expect(signalTarget.listenerCount('SIGINT')).toBe(0)
  })
})
