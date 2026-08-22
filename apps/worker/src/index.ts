import path from 'node:path'
import { pathToFileURL } from 'node:url'
import pino from 'pino'
import { loadEnv, type Env } from '@webreg/config'
import { prisma } from '@webreg/db'
import type { CatalogSource, SnapshotLimits } from '@webreg/catalog'
import { classifyWorkerError } from './failure.js'
import { syncCatalogSource } from './source-sync.js'
import { createCatalogSource } from './sources/factory.js'

const FULL_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_SEAT_REFRESH_MINUTES = 30
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000
const IDLE_KEEPALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000

const logger = pino({ name: 'worker' })

type WorkerLogger = Pick<typeof logger, 'info' | 'warn' | 'error'>
type IntervalHandle = ReturnType<typeof setInterval>

export type WorkerHandle = { stop(): Promise<void> }

export type WorkerDependencies = {
  source: CatalogSource
  sync?: (source: CatalogSource, limits: Partial<SnapshotLimits>) => Promise<unknown>
  seatRefresh?: () => Promise<unknown>
  snapshotLimits?: Partial<SnapshotLimits>
  fullSyncIntervalMs?: number
  seatRefreshIntervalMs?: number
  shutdownTimeoutMs?: number
  timers?: {
    setInterval: typeof setInterval
    clearInterval: typeof clearInterval
    setTimeout: typeof setTimeout
    clearTimeout: typeof clearTimeout
  }
  closeResources?: () => Promise<void>
  disconnect?: () => Promise<void>
  log?: WorkerLogger
}

function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'))
  } catch {
    // Production injects environment variables; local .env is optional.
  }
}

/** Starts catalog jobs and returns an idempotent, bounded graceful-shutdown handle. */
export async function startWorker(dependencies: WorkerDependencies): Promise<WorkerHandle> {
  const timers = dependencies.timers ?? { setInterval, clearInterval, setTimeout, clearTimeout }
  const workerLogger = dependencies.log ?? logger
  const limits = dependencies.snapshotLimits ?? {}
  const sync = dependencies.sync ?? ((source, snapshotLimits) =>
    syncCatalogSource(source, { snapshotLimits }))
  const activeJobs = new Set<Promise<void>>()
  const runningJobs = new Set<string>()
  const intervals: IntervalHandle[] = []
  let stopped = false
  let stopPromise: Promise<void> | undefined

  const closeDependencies = async (): Promise<void> => {
    let cleanupError: unknown
    try {
      await dependencies.closeResources?.()
    } catch (error) {
      cleanupError = error
    }
    try {
      await (dependencies.disconnect ?? (() => prisma.$disconnect()))()
    } catch (error) {
      cleanupError ??= error
    }
    if (cleanupError !== undefined) throw cleanupError
  }

  const schedule = (name: string, job: () => Promise<unknown>): void => {
    if (stopped) return
    if (runningJobs.has(name)) {
      workerLogger.warn({ name }, 'tick still running, skipping')
      return
    }
    runningJobs.add(name)
    let tracked: Promise<void>
    tracked = job()
      .then(() => undefined)
      .catch(() => {
        workerLogger.error({ name, category: 'worker_operation_failed' }, 'tick failed')
      })
      .finally(() => {
        activeJobs.delete(tracked)
        runningJobs.delete(name)
      })
    activeJobs.add(tracked)
  }

  // Startup failures are fatal and are sanitized only at the entrypoint boundary.
  try {
    await sync(dependencies.source, limits)
  } catch (error) {
    try {
      await closeDependencies()
    } catch {
      // Preserve the startup failure; the entrypoint logs only its allowlisted category.
    }
    throw error
  }

  // Fixture is immutable release data: import once, then idle. TSS never reaches here.
  if (dependencies.source.kind === 'legacy-soc') {
    intervals.push(timers.setInterval(
      () => schedule('full sync', () => sync(dependencies.source, limits)),
      dependencies.fullSyncIntervalMs ?? FULL_SYNC_INTERVAL_MS
    ))
    intervals.push(timers.setInterval(
      () => schedule('seat refresh', dependencies.seatRefresh ?? (() => sync(dependencies.source, limits))),
      dependencies.seatRefreshIntervalMs ?? DEFAULT_SEAT_REFRESH_MINUTES * 60 * 1000
    ))
  } else {
    // Keep the fixture-backed worker alive for platform liveness and graceful signals.
    intervals.push(timers.setInterval(() => undefined, IDLE_KEEPALIVE_INTERVAL_MS))
  }
  return {
    stop(): Promise<void> {
      stopPromise ??= (async () => {
        stopped = true
        for (const interval of intervals) timers.clearInterval(interval)

        if (activeJobs.size > 0) {
          let timeout: ReturnType<typeof setTimeout> | undefined
          await Promise.race([
            Promise.allSettled([...activeJobs]),
            new Promise<void>(resolve => {
              timeout = timers.setTimeout(resolve, dependencies.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS)
              timeout.unref?.()
            })
          ])
          if (timeout) timers.clearTimeout(timeout)
        }

        let cleanupError: unknown
        try {
          await closeDependencies()
        } catch (error) {
          cleanupError = error
        }
        workerLogger.info('worker stopped')
        if (cleanupError !== undefined) throw cleanupError
      })()
      return stopPromise
    }
  }
}

export function reportWorkerStartupFailure(
  error: unknown,
  startupLogger: Pick<typeof logger, 'error'> = logger
): void {
  startupLogger.error({ category: classifyWorkerError(error) }, 'worker failed to start')
}

export async function createDefaultWorker(
  source: Record<string, string | undefined> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  dependencies: {
    loadWorkerEnv?: typeof loadEnv
    createSource?: typeof createCatalogSource
    start?: typeof startWorker
  } = {}
): Promise<WorkerHandle> {
  const env: Env = (dependencies.loadWorkerEnv ?? loadEnv)(source, nodeEnv)
  const catalogSource = (dependencies.createSource ?? createCatalogSource)(env)
  const snapshotLimits = {
    maxCourses: env.CATALOG_MAX_COURSES,
    maxSections: env.CATALOG_MAX_SECTIONS,
    maxSerializedBytes: env.CATALOG_MAX_SNAPSHOT_BYTES
  }
  const refreshable = catalogSource as CatalogSource & {
    refreshSeats?: (dependencies?: { snapshotLimits?: Partial<SnapshotLimits> }) => Promise<void>
  }
  return (dependencies.start ?? startWorker)({
    source: catalogSource,
    seatRefresh: catalogSource.kind === 'legacy-soc' && refreshable.refreshSeats
      ? () => refreshable.refreshSeats!({ snapshotLimits })
      : undefined,
    snapshotLimits,
    seatRefreshIntervalMs: (env.SEAT_REFRESH_MINUTES ?? DEFAULT_SEAT_REFRESH_MINUTES) * 60 * 1000
  })
}

type SignalTarget = {
  on(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
  off(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown
}

/** Installs signal handling before startup so an early signal cannot strand initialized resources. */
export async function runWorkerEntrypoint(
  start: () => Promise<WorkerHandle> = createDefaultWorker,
  signalTarget: SignalTarget = process,
  setFailed: () => void = () => { process.exitCode = 1 }
): Promise<void> {
  let handle: WorkerHandle | undefined
  let shutdownRequested = false
  let shutdownPromise: Promise<void> | undefined
  let handlersRemoved = false

  const removeHandlers = (): void => {
    if (handlersRemoved) return
    handlersRemoved = true
    signalTarget.off('SIGTERM', shutdown)
    signalTarget.off('SIGINT', shutdown)
  }

  const stop = (): Promise<void> => {
    if (!handle) return Promise.resolve()
    shutdownPromise ??= handle.stop().catch(() => {
      reportWorkerStartupFailure(new Error('worker shutdown failed'))
      setFailed()
    })
    return shutdownPromise
  }
  const shutdown = (): void => {
    shutdownRequested = true
    if (handle) void stop().finally(removeHandlers)
  }

  signalTarget.on('SIGTERM', shutdown)
  signalTarget.on('SIGINT', shutdown)
  try {
    handle = await start()
    if (shutdownRequested) {
      try {
        await stop()
      } finally {
        removeHandlers()
      }
    }
  } catch (error) {
    removeHandlers()
    reportWorkerStartupFailure(error)
    setFailed()
  }
}

function isEntrypoint(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
}

if (isEntrypoint()) {
  loadDotEnv()
  void runWorkerEntrypoint()
}
