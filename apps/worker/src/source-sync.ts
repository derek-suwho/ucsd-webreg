import pino from 'pino'
import { prisma } from '@webreg/db'
import {
  FixtureOwnershipError,
  SnapshotLimitError,
  assertFixtureCatalogOwnership,
  buildSnapshot,
  expectedFixtureOwnership,
  flattenScrapedCourses,
  normalizeDepartment,
  sourceTermIdSchema,
  sourceTermSchema,
  upsertDepartment,
  type CatalogSource,
  type NormalizedCourse,
  type SnapshotLimits,
  type SourceTerm
} from '@webreg/catalog'
import { withCatalogLock } from './catalog-lock.js'

const logger = pino({ name: 'worker' })

type SourceSyncFailureCategory =
  | 'catalog_lock_skipped'
  | 'catalog_write_failed'
  | 'department_sync_failed'
  | 'fixture_ownership_failed'
  | 'snapshot_build_failed'
  | 'snapshot_limit_exceeded'

export class CatalogSourceSyncError extends Error {
  constructor(readonly category: SourceSyncFailureCategory) {
    super(category)
    this.name = 'CatalogSourceSyncError'
  }
}

export type SourceSyncSummary = {
  terms: Array<{ termId: string; okDepts: string[]; failedDepts: string[] }>
}

type LockRunner = <T>(
  termId: string,
  operation: () => Promise<T>
) => Promise<{ acquired: boolean; value?: T }>

export type SourceSyncDependencies = {
  withLock?: LockRunner
  upsert?: typeof upsertDepartment
  snapshotLimits?: Partial<SnapshotLimits>
  log?: Pick<typeof logger, 'info' | 'warn' | 'error'>
}

type PreparedDepartment = {
  department: string
  courses: NormalizedCourse[]
  warnings: string[]
}

function termDates(term: SourceTerm): { startsAt: Date; endsAt: Date } {
  return {
    startsAt: new Date(`${term.startsAt}T00:00:00.000Z`),
    endsAt: new Date(`${term.endsAt}T00:00:00.000Z`)
  }
}

function categoryFor(
  error: unknown,
  fallback: SourceSyncFailureCategory
): SourceSyncFailureCategory {
  if (error instanceof CatalogSourceSyncError) return error.category
  if (error instanceof FixtureOwnershipError) return 'fixture_ownership_failed'
  if (error instanceof SnapshotLimitError) return 'snapshot_limit_exceeded'
  return fallback
}

/** Imports every term exposed by a CatalogSource; snapshots publish only complete terms. */
export async function syncCatalogSource(
  source: CatalogSource,
  dependencies: SourceSyncDependencies = {}
): Promise<SourceSyncSummary> {
  const syncLogger = dependencies.log ?? logger
  let terms: SourceTerm[]
  try {
    terms = (await source.listTerms()).map(term => sourceTermSchema.parse(term))
  } catch (error) {
    const now = new Date()
    const knownTermIds = new Set(source.knownTermIds.flatMap(candidate => {
      const parsed = sourceTermIdSchema.safeParse(candidate)
      return parsed.success ? [parsed.data] : []
    }))
    for (const termId of knownTermIds) {
      try {
        await prisma.importRun.create({ data: {
          termId,
          kind: 'full',
          startedAt: now,
          finishedAt: now,
          okDepts: [],
          failedDepts: [],
          error: 'department_list_failed'
        } })
      } catch {
        syncLogger.error({ termId }, 'failed to record term-list failure')
      }
    }
    throw error
  }
  if (new Set(terms.map(term => term.id)).size !== terms.length) {
    throw new CatalogSourceSyncError('catalog_write_failed')
  }
  const summaries: SourceSyncSummary['terms'] = []

  for (const term of terms) {
    const locked = await (dependencies.withLock ?? withCatalogLock)(term.id, async () => {
      const run = await prisma.importRun.create({
        data: { termId: term.id, kind: 'full', startedAt: new Date(), okDepts: [], failedDepts: [] }
      })
      const prepared: PreparedDepartment[] = []
      const okDepts: string[] = []
      const failedDepts: string[] = []
      let failure: CatalogSourceSyncError | undefined

      // Complete prefetch boundary: no catalog row changes occur until every department is valid.
      for (const department of term.departments) {
        try {
          const scraped = await source.fetchDepartment(term.id, department)
          const normalized = normalizeDepartment(flattenScrapedCourses(scraped), term.id)
          prepared.push({ department, ...normalized })
        } catch {
          failedDepts.push(department)
        }
      }
      if (failedDepts.length > 0) failure = new CatalogSourceSyncError('department_sync_failed')

      if (!failure) {
        let stage: SourceSyncFailureCategory = 'catalog_write_failed'
        try {
          if (source.kind === 'fixture') {
            stage = 'fixture_ownership_failed'
            await assertFixtureCatalogOwnership(term.id, prepared)
          }
          stage = 'catalog_write_failed'
          const dates = termDates(term)
          await prisma.term.upsert({
            where: { id: term.id },
            create: { id: term.id, name: term.name, active: true, ...dates },
            update: { name: term.name, active: true, ...dates }
          })

          for (const item of prepared) {
            try {
              for (const warning of item.warnings) {
                syncLogger.warn({ termId: term.id, department: item.department, warning }, 'normalize warning')
              }
              await (dependencies.upsert ?? upsertDepartment)(term.id, item.department, item.courses)
              okDepts.push(item.department)
            } catch {
              failedDepts.push(item.department)
              failure = new CatalogSourceSyncError('department_sync_failed')
              break
            }
          }

          if (!failure) {
            stage = 'snapshot_build_failed'
            await buildSnapshot(term.id, {
              sourceKind: source.kind,
              mode: source.kind === 'fixture' ? 'demo' : 'live',
              sourceGeneratedAt: term.sourceGeneratedAt
            }, dependencies.snapshotLimits, {
              expectedFixtureOwnership: source.kind === 'fixture'
                ? expectedFixtureOwnership(prepared)
                : undefined
            })
          }
        } catch (error) {
          failure = new CatalogSourceSyncError(categoryFor(error, stage))
        }
      }

      const error = failure?.category ?? null
      let completionFailed = false
      try {
        await prisma.importRun.update({
          where: { id: run.id },
          data: { finishedAt: new Date(), okDepts, failedDepts, error }
        })
      } catch {
        completionFailed = true
        syncLogger.error({ termId: term.id }, 'failed to record ImportRun completion')
      }

      if (completionFailed && !failure) {
        failure = new CatalogSourceSyncError('catalog_write_failed')
      }

      if (failure) {
        syncLogger.error({ termId: term.id, category: failure.category }, 'source sync failed')
        throw failure
      }
      return { termId: term.id, okDepts, failedDepts }
    })

    if (!locked.acquired || !locked.value) {
      syncLogger.error(
        { termId: term.id, category: 'catalog_lock_skipped' },
        'source sync failed'
      )
      throw new CatalogSourceSyncError('catalog_lock_skipped')
    }
    summaries.push(locked.value)
  }

  return { terms: summaries }
}
