import pino from 'pino'
import { prisma } from '@webreg/db'
import {
  SnapshotLimitError,
  buildSnapshot,
  normalizeDepartment,
  updateSeatsAndRecordSnapshots,
  type NormalizedCourse,
  type SnapshotLimits
} from '@webreg/catalog'
import { fetchDepartmentRows, type SyncFetcher } from './crawl.js'
import type { WorkerFailureCategory } from './failure.js'

const logger = pino({ name: 'worker' })

export type { SyncFetcher } from './crawl.js'

export class SeatRefreshError extends Error {
  constructor(readonly category: WorkerFailureCategory) {
    super(category)
    this.name = 'SeatRefreshError'
  }
}

/** Prefetches a complete legacy term, then applies seats; partials never publish a snapshot. */
export async function seatRefresh(
  fetcher: SyncFetcher,
  termId: string,
  options: {
    snapshotLimits?: Partial<SnapshotLimits>
    updateSeats?: typeof updateSeatsAndRecordSnapshots
  } = {}
): Promise<void> {
  const run = await prisma.importRun.create({
    data: { termId, kind: 'seats', startedAt: new Date(), okDepts: [], failedDepts: [] }
  })
  const prepared: Array<{ department: string; courses: NormalizedCourse[] }> = []
  const okDepts: string[] = []
  const failedDepts: string[] = []
  let failure: SeatRefreshError | undefined
  let anyChanged = false

  try {
    const departments = await fetcher.fetchDepartmentList(termId)
    for (const department of departments) {
      try {
        const rows = await fetchDepartmentRows(fetcher, termId, department)
        const { courses, warnings } = normalizeDepartment(rows, termId)
        for (const warning of warnings) logger.warn({ termId, department, warning }, 'normalize warning')
        prepared.push({ department, courses })
      } catch {
        failedDepts.push(department)
      }
    }
    if (failedDepts.length > 0) failure = new SeatRefreshError('department_sync_failed')
  } catch {
    failure = new SeatRefreshError('department_list_failed')
  }

  if (!failure) {
    for (const item of prepared) {
      try {
        const result = await (options.updateSeats ?? updateSeatsAndRecordSnapshots)(
          termId,
          item.courses.flatMap(course => course.sections)
        )
        if (result.changed) anyChanged = true
        okDepts.push(item.department)
      } catch {
        failedDepts.push(item.department)
        failure = new SeatRefreshError('department_sync_failed')
        break
      }
    }
  }

  if (!failure && anyChanged) {
    try {
      await buildSnapshot(termId, {
        sourceKind: 'legacy-soc', mode: 'live', sourceGeneratedAt: new Date().toISOString()
      }, options.snapshotLimits)
    } catch (error) {
      failure = new SeatRefreshError(error instanceof SnapshotLimitError
        ? 'snapshot_limit_exceeded'
        : 'snapshot_build_failed')
    }
  }

  let completionFailed = false
  try {
    await prisma.importRun.update({
      where: { id: run.id },
      data: { finishedAt: new Date(), okDepts, failedDepts, error: failure?.category ?? null }
    })
  } catch {
    completionFailed = true
    logger.error({ termId, runId: run.id.toString() }, 'failed to record ImportRun completion')
  }
  if (completionFailed && !failure) failure = new SeatRefreshError('catalog_write_failed')
  if (failure) {
    logger.error({ termId, category: failure.category }, 'seat refresh failed')
    throw failure
  }
}
