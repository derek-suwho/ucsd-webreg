import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FixtureCatalogSource, type CatalogSource } from '@webreg/catalog'
import { prisma } from '@webreg/db'
import { syncCatalogSource } from './source-sync.js'
import { runWorkerEntrypoint, startWorker } from './index.js'

const fixture = JSON.parse(readFileSync(
  new URL('../../../packages/catalog/fixtures/fa26-demo.json', import.meta.url),
  'utf8'
))

describe.skipIf(!process.env.DATABASE_URL)('syncCatalogSource', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ImportRun", "CatalogSnapshot", "SeatSnapshot", "Exam", "Meeting", "Section", "Course", "Term" RESTART IDENTITY CASCADE'
    )
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('imports fixture terms through normalization, reconciliation, provenance, and bounded snapshots', async () => {
    const source = new FixtureCatalogSource(fixture)
    const result = await syncCatalogSource(source, {
      withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
    })

    expect(result.terms).toEqual([{
      termId: 'FA26',
      okDepts: ['DEMO', 'LABX'],
      failedDepts: []
    }])
    expect(await prisma.term.findUniqueOrThrow({ where: { id: 'FA26' } })).toMatchObject({
      name: 'Fall Quarter 2026 Demo',
      active: true,
      startsAt: new Date('2026-09-24T00:00:00.000Z'),
      endsAt: new Date('2026-12-04T00:00:00.000Z')
    })
    const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect(snapshot.data).toMatchObject({
      termId: 'FA26',
      provenance: {
        sourceKind: 'fixture',
        mode: 'demo',
        sourceGeneratedAt: '2026-08-21T00:00:00.000Z'
      }
    })
    expect(await prisma.importRun.findFirstOrThrow()).toMatchObject({
      kind: 'full', okDepts: ['DEMO', 'LABX'], failedDepts: [], error: null
    })
  })

  it('records a finished failed run for source-known terms when term listing fails', async () => {
    const source = new FixtureCatalogSource(fixture)
    await syncCatalogSource(source, {
      withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
    })
    await prisma.term.create({ data: {
      id: 'WI27', name: 'Unrelated', active: true,
      startsAt: new Date('2027-01-04'), endsAt: new Date('2027-03-12')
    } })
    const before = await prisma.importRun.count({ where: { termId: 'FA26', kind: 'full' } })
    const failing: CatalogSource = {
      kind: 'fixture' as const,
      knownTermIds: ['FA26', 'FA26', ''] as const,
      listTerms: async () => { throw new Error('private source listing detail') },
      fetchDepartment: async () => []
    }

    await expect(syncCatalogSource(failing)).rejects.toThrow('private source listing detail')

    expect(await prisma.importRun.count({ where: { termId: 'FA26', kind: 'full' } })).toBe(before + 1)
    expect(await prisma.importRun.findFirstOrThrow({
      where: { termId: 'FA26', kind: 'full' }, orderBy: { startedAt: 'desc' }
    })).toMatchObject({
      finishedAt: expect.any(Date), okDepts: [], failedDepts: [], error: 'department_list_failed'
    })
    expect(await prisma.importRun.count({ where: { termId: 'WI27' } })).toBe(0)
    expect(await prisma.importRun.count({ where: { termId: '' } })).toBe(0)
  })

  it('rejects prefetch partials without mutations or snapshot replacement', async () => {
    const source = new FixtureCatalogSource(fixture)
    await syncCatalogSource(source, {
      withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
    })
    const failing: CatalogSource = {
      kind: 'fixture',
      knownTermIds: source.knownTermIds,
      listTerms: () => source.listTerms(),
      fetchDepartment: async (termId, department) => {
        if (department === 'DEMO') throw new Error('private upstream body')
        return source.fetchDepartment(termId, department)
      }
    }

    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await expect(syncCatalogSource(failing, {
      withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
    })).rejects.toMatchObject({ category: 'department_sync_failed' })

    expect(await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })).toEqual(before)
    expect(await prisma.section.count({ where: { course: { subject: 'DEMO' }, isCancelled: false } }))
      .toBeGreaterThan(0)
    expect(await prisma.importRun.findFirstOrThrow({ orderBy: { id: 'desc' } })).toMatchObject({
      okDepts: [], failedDepts: ['DEMO'], error: 'department_sync_failed'
    })
  })

  it.each([
    ['course', async () => prisma.course.create({ data: {
      id: 'FA26:ROGUE:1', termId: 'FA26', subject: 'ROGUE', number: '1',
      title: 'Rogue', unitsFrom: 4, unitsTo: 4, unitsInc: 0, restriction: []
    } })],
    ['section', async () => prisma.section.create({ data: {
      id: 'FA26:DEMO:101:Z99', courseId: 'FA26:DEMO:101', sectionCode: 'Z99', familyCode: 'Z'
    } })]
  ] as const)('rejects rogue fixture %s ownership without applying demo provenance', async (_kind, contaminate) => {
    const source = new FixtureCatalogSource(fixture)
    const lock = async <T>(_termId: string, operation: () => Promise<T>) => ({
      acquired: true, value: await operation()
    })
    await syncCatalogSource(source, { withLock: lock })
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await contaminate()

    await expect(syncCatalogSource(source, { withLock: lock }))
      .rejects.toMatchObject({ category: 'fixture_ownership_failed' })

    expect(await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })).toEqual(before)
    expect(await prisma.importRun.findFirstOrThrow({ orderBy: { id: 'desc' } })).toMatchObject({
      okDepts: [], failedDepts: [], error: 'fixture_ownership_failed'
    })
  })

  it('rejects an apply failure without replacing the last-good snapshot', async () => {
    const source = new FixtureCatalogSource(fixture)
    const lock = async <T>(_termId: string, operation: () => Promise<T>) => ({
      acquired: true, value: await operation()
    })
    await syncCatalogSource(source, { withLock: lock })
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })

    await expect(syncCatalogSource(source, {
      withLock: lock,
      upsert: async (termId, department, courses) => {
        if (department === 'LABX') throw new Error('database private detail')
        const { upsertDepartment } = await import('@webreg/catalog')
        return upsertDepartment(termId, department, courses)
      }
    })).rejects.toMatchObject({ category: 'department_sync_failed' })

    expect(await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })).toEqual(before)
    expect(await prisma.importRun.findFirstOrThrow({ orderBy: { id: 'desc' } })).toMatchObject({
      okDepts: ['DEMO'], failedDepts: ['LABX'], error: 'department_sync_failed'
    })
  })

  it('rejects a skipped term lock instead of reporting success', async () => {
    const source = new FixtureCatalogSource(fixture)
    await expect(syncCatalogSource(source, {
      withLock: async () => ({ acquired: false })
    })).rejects.toMatchObject({ category: 'catalog_lock_skipped' })
    expect(await prisma.importRun.count()).toBe(0)
    expect(await prisma.catalogSnapshot.count()).toBe(0)
  })

  it('finishes the initial ImportRun before honoring an early termination signal', async () => {
    const fixtureSource = new FixtureCatalogSource(fixture)
    let releaseFetch!: () => void
    let markFetchStarted!: () => void
    const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve })
    const fetchRelease = new Promise<void>(resolve => { releaseFetch = resolve })
    let first = true
    const delayed: CatalogSource = {
      kind: 'fixture',
      knownTermIds: fixtureSource.knownTermIds,
      listTerms: () => fixtureSource.listTerms(),
      fetchDepartment: async (termId, department) => {
        if (first) {
          first = false
          markFetchStarted()
          await fetchRelease
        }
        return fixtureSource.fetchDepartment(termId, department)
      }
    }
    const signalTarget = new EventEmitter()
    const disconnect = vi.fn(async () => {})
    const running = runWorkerEntrypoint(
      () => startWorker({
        source: delayed,
        sync: source => syncCatalogSource(source, {
          withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
        }),
        disconnect
      }),
      signalTarget
    )

    await fetchStarted
    signalTarget.emit('SIGINT')
    releaseFetch()
    await running

    expect(await prisma.importRun.findFirstOrThrow()).toMatchObject({
      finishedAt: expect.any(Date), error: null, okDepts: ['DEMO', 'LABX']
    })
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('rejects snapshot bound failures after recording the truthful run outcome', async () => {
    const source = new FixtureCatalogSource(fixture)

    await expect(syncCatalogSource(source, {
      withLock: async (_termId, operation) => ({ acquired: true, value: await operation() }),
      snapshotLimits: { maxCourses: 1 }
    })).rejects.toMatchObject({ category: 'snapshot_limit_exceeded' })

    expect(await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })).toBeNull()
    expect(await prisma.importRun.findFirstOrThrow()).toMatchObject({
      okDepts: ['DEMO', 'LABX'],
      failedDepts: [],
      error: 'snapshot_limit_exceeded'
    })
    expect((await prisma.importRun.findFirstOrThrow()).finishedAt).not.toBeNull()
  })

  it('rejects success when ImportRun completion cannot be recorded', async () => {
    const source = new FixtureCatalogSource(fixture)
    const update = vi.spyOn(prisma.importRun, 'update').mockRejectedValueOnce(new Error('write failed'))
    try {
      await expect(syncCatalogSource(source, {
        withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
      })).rejects.toMatchObject({ category: 'catalog_write_failed' })
    } finally {
      update.mockRestore()
    }
    expect(await prisma.catalogSnapshot.count()).toBe(1)
  })

  it('preserves the original partial failure when completion recording also fails', async () => {
    const fixtureSource = new FixtureCatalogSource(fixture)
    const failing: CatalogSource = {
      kind: 'fixture', knownTermIds: fixtureSource.knownTermIds, listTerms: () => fixtureSource.listTerms(),
      fetchDepartment: async (termId, department) => {
        if (department === 'DEMO') throw new Error('source failed')
        return fixtureSource.fetchDepartment(termId, department)
      }
    }
    const update = vi.spyOn(prisma.importRun, 'update').mockRejectedValueOnce(new Error('write failed'))
    try {
      await expect(syncCatalogSource(failing, {
        withLock: async (_termId, operation) => ({ acquired: true, value: await operation() })
      })).rejects.toMatchObject({ category: 'department_sync_failed' })
    } finally {
      update.mockRestore()
    }
  })
})
