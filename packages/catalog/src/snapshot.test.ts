import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@webreg/db'
import type { NormalizedCourse } from './normalize.js'
import { upsertDepartment } from './repo.js'
import { buildSnapshot } from './snapshot.js'
import type { CatalogData } from './client-types.js'
import { expectedFixtureOwnership } from './fixture-ownership.js'
import { withTermCatalogTransaction } from './term-transaction.js'

const provenance = {
  sourceKind: 'fixture' as const,
  mode: 'demo' as const,
  sourceGeneratedAt: '2026-08-21T00:00:00.000Z'
}

describe.skipIf(!process.env.DATABASE_URL)('buildSnapshot', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "CatalogSnapshot", "SeatSnapshot", "Exam", "Meeting", "Section", "Course", "Term" RESTART IDENTITY CASCADE'
    )
    await prisma.term.create({
      data: {
        id: 'FA26',
        name: 'Fall Quarter 2026',
        active: true,
        startsAt: new Date('2026-09-24'),
        endsAt: new Date('2026-12-04')
      }
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  function makeCourse(overrides: Partial<NormalizedCourse> = {}): NormalizedCourse {
    return {
      id: 'FA26:CSE:110',
      subject: 'CSE',
      number: '110',
      title: 'Software Engineering',
      unitsFrom: 4,
      unitsTo: 4,
      unitsInc: 0,
      restriction: [],
      sections: [
        {
          id: 'FA26:CSE:110:A01',
          sectionCode: 'A01',
          familyCode: 'A',
          registrationNumber: 123456,
          instructor: 'Staff',
          capacity: 30,
          available: 10,
          waitlisted: 0,
          isCancelled: false,
          meetings: [{ type: 'DI', days: 'F', startMin: 660, endMin: 700, building: null, room: null }],
          exams: [{ type: 'FI', date: '2026-12-07', startMin: 480, endMin: 600, building: 'CENTR', room: '101' }]
        },
        {
          id: 'FA26:CSE:110:A00',
          sectionCode: 'A00',
          familyCode: 'A',
          registrationNumber: null,
          instructor: 'Staff',
          capacity: null,
          available: null,
          waitlisted: null,
          isCancelled: false,
          meetings: [{ type: 'LE', days: 'MWF', startMin: 600, endMin: 650, building: 'CENTR', room: '101' }],
          exams: []
        }
      ],
      ...overrides
    }
  }

  it('builds a snapshot from seeded courses and writes CatalogSnapshot with version 1', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])

    const result = await buildSnapshot('FA26', provenance)
    expect(result.version).toBe(1)

    const row = await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })
    expect(row).not.toBeNull()
    expect(row!.version).toBe(1)

    const data = row!.data as unknown as CatalogData
    expect(data.termId).toBe('FA26')
    expect(data.version).toBe(1)
    expect(typeof data.generatedAt).toBe('string')
    expect(data.provenance).toEqual(provenance)

    const course = data.courses['FA26:CSE:110']
    expect(course).toBeDefined()
    expect(course.subject).toBe('CSE')
    expect(course.number).toBe('110')
    expect(course.title).toBe('Software Engineering')
    expect(course.unitsFrom).toBe(4)
    expect(course.unitsTo).toBe(4)
    expect(course.unitsInc).toBe(0)
    // sectionIds ordered by sectionCode asc
    expect(course.sectionIds).toEqual(['FA26:CSE:110:A00', 'FA26:CSE:110:A01'])

    const secA01 = data.sections['FA26:CSE:110:A01']
    expect(secA01).toBeDefined()
    expect(secA01.courseId).toBe('FA26:CSE:110')
    expect(secA01.code).toBe('A01')
    expect(secA01.family).toBe('A')
    expect(secA01.regNum).toBe(123456)
    expect(secA01.instructor).toBe('Staff')
    expect(secA01.cap).toBe(30)
    expect(secA01.avail).toBe(10)
    expect(secA01.wait).toBe(0)
    expect(secA01.cancelled).toBe(false)
    expect(secA01.meetings).toEqual([
      { type: 'DI', days: 'F', start: 660, end: 700, bldg: null, room: null }
    ])
    expect(secA01.exams).toEqual([{ type: 'FI', date: '2026-12-07', start: 480, end: 600 }])

    const secA00 = data.sections['FA26:CSE:110:A00']
    expect(secA00.cap).toBeNull()
    expect(secA00.avail).toBeNull()
    expect(secA00.wait).toBeNull()
    expect(secA00.regNum).toBeNull()
  })

  it('increments version on second call', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])

    const first = await buildSnapshot('FA26', provenance)
    expect(first.version).toBe(1)

    const second = await buildSnapshot('FA26', provenance)
    expect(second.version).toBe(2)

    const row = await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })
    expect(row!.version).toBe(2)
    const data = row!.data as unknown as CatalogData
    expect(data.version).toBe(2)
  })

  it('allows exact course and section limits', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])

    await expect(buildSnapshot('FA26', provenance, {
      maxCourses: 1,
      maxSections: 2,
      maxSerializedBytes: 1_000_000
    })).resolves.toEqual({ version: 1 })
  })

  it.each([
    ['course', { maxCourses: 0, maxSections: 2, maxSerializedBytes: 1_000_000 }],
    ['section', { maxCourses: 1, maxSections: 1, maxSerializedBytes: 1_000_000 }]
  ])('rejects above the %s limit without replacing the last-good snapshot', async (_kind, limits) => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])
    await buildSnapshot('FA26', provenance)
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })

    await expect(buildSnapshot('FA26', provenance, limits)).rejects.toThrow(/snapshot .* limit/i)

    const after = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect(after.version).toBe(before.version)
    expect(after.data).toEqual(before.data)
  })

  it('allows the exact serialized byte limit and rejects one byte below it without incrementing', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse({ title: 'UTF-8 🔐 course' })])
    await buildSnapshot('FA26', provenance)
    const first = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    const exactBytes = Buffer.byteLength(JSON.stringify({
      ...(first.data as unknown as CatalogData),
      version: 2
    }), 'utf8')

    await expect(buildSnapshot('FA26', provenance, {
      maxCourses: 1,
      maxSections: 2,
      maxSerializedBytes: exactBytes
    })).resolves.toEqual({ version: 2 })

    const beforeReject = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await expect(buildSnapshot('FA26', provenance, {
      maxCourses: 1,
      maxSections: 2,
      maxSerializedBytes: exactBytes - 1
    })).rejects.toThrow(/serialized byte limit/i)
    const afterReject = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect(afterReject.version).toBe(2)
    expect(afterReject.data).toEqual(beforeReject.data)
  })

  it('serializes concurrent direct builds into consecutive versions', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])

    const results = await Promise.all([
      buildSnapshot('FA26', provenance),
      buildSnapshot('FA26', provenance)
    ])

    expect(results.map(result => result.version).sort((a, b) => a - b)).toEqual([1, 2])
    expect(await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } }))
      .toMatchObject({ version: 2 })
  })

  it('materializes a prior writer committed while the snapshot waited for the term lock', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse({ title: 'Old' })])
    let releaseWriter!: () => void
    const release = new Promise<void>(resolve => { releaseWriter = resolve })
    let writerReady!: () => void
    const ready = new Promise<void>(resolve => { writerReady = resolve })
    const writer = withTermCatalogTransaction('FA26', async tx => {
      await tx.course.update({ where: { id: 'FA26:CSE:110' }, data: { title: 'New' } })
      writerReady()
      await release
    })
    await ready

    const build = buildSnapshot('FA26', provenance)
    await vi.waitFor(async () => {
      const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM pg_locks
        WHERE locktype = 'advisory' AND NOT granted
      `
      expect(Number(waits[0]?.count ?? 0)).toBeGreaterThan(0)
    })
    releaseWriter()
    await writer
    await build

    const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect((snapshot.data as unknown as CatalogData).courses['FA26:CSE:110'].title).toBe('New')
  })

  it('cannot publish a rogue insert committed after materialization', async () => {
    const owned = makeCourse()
    await upsertDepartment('FA26', 'CSE', [owned])
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    let materialized!: () => void
    const materializationDone = new Promise<void>(resolve => { materialized = resolve })
    const build = buildSnapshot('FA26', provenance, {}, {
      expectedFixtureOwnership: expectedFixtureOwnership([{ courses: [owned] }]),
      afterMaterialized: async () => {
        materialized()
        await blocked
      }
    })
    await materializationDone
    await prisma.course.create({ data: {
      id: 'FA26:ROGUE:1', termId: 'FA26', subject: 'ROGUE', number: '1',
      title: 'Rogue', unitsFrom: 4, unitsTo: 4, unitsInc: 0, restriction: []
    } })
    release()
    await expect(build).resolves.toEqual({ version: 1 })

    const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect((snapshot.data as unknown as CatalogData).courses).not.toHaveProperty('FA26:ROGUE:1')
    await expect(buildSnapshot('FA26', provenance, {}, {
      expectedFixtureOwnership: expectedFixtureOwnership([{ courses: [owned] }])
    })).rejects.toThrow(/course IDs/i)
  })

  it('rejects an expected section ID attached to the wrong expected course', async () => {
    const owned = makeCourse()
    const second = makeCourse({ id: 'FA26:CSE:120', number: '120', sections: [] })
    await upsertDepartment('FA26', 'CSE', [owned, second])
    await prisma.section.update({
      where: { id: 'FA26:CSE:110:A01' },
      data: { courseId: second.id }
    })

    await expect(buildSnapshot('FA26', provenance, {}, {
      expectedFixtureOwnership: expectedFixtureOwnership([{ courses: [owned, second] }])
    })).rejects.toThrow(/section parent IDs/i)
    expect(await prisma.catalogSnapshot.count()).toBe(0)
  })

  it('serializes same-term production mutations outside the bounded snapshot boundary', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS snapshot_test_block_trigger ON "CatalogSnapshot"')
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION snapshot_test_block() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(91234567);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER snapshot_test_block_trigger
      BEFORE INSERT OR UPDATE ON "CatalogSnapshot"
      FOR EACH ROW EXECUTE FUNCTION snapshot_test_block()
    `)

    let releaseBlocker!: () => void
    const release = new Promise<void>(resolve => { releaseBlocker = resolve })
    let blockerReady!: () => void
    const ready = new Promise<void>(resolve => { blockerReady = resolve })
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_lock(91234567) IS NULL AS locked`
      blockerReady()
      await release
      await tx.$queryRaw`SELECT pg_advisory_unlock(91234567) AS unlocked`
    })
    await ready

    try {
      const build = buildSnapshot('FA26', provenance, {
        maxCourses: 1,
        maxSections: 2,
        maxSerializedBytes: 1_000_000
      })
      await vi.waitFor(async () => {
        const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
        `
        expect(Number(waits[0]?.count ?? 0)).toBeGreaterThan(0)
      })

      const addedCourse = makeCourse({
        id: 'FA26:CSE:120', number: '120', title: 'New course', sections: []
      })
      let mutationSettled = false
      const mutation = upsertDepartment('FA26', 'CSE', [makeCourse(), addedCourse])
        .finally(() => { mutationSettled = true })

      await vi.waitFor(async () => {
        const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
        `
        expect(Number(waits[0]?.count ?? 0)).toBeGreaterThan(1)
      })
      expect(mutationSettled).toBe(false)

      releaseBlocker()
      await expect(build).resolves.toEqual({ version: 1 })
      await mutation

      const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
      expect(Object.keys((snapshot.data as unknown as CatalogData).courses)).toHaveLength(1)
      await expect(buildSnapshot('FA26', provenance, {
        maxCourses: 1,
        maxSections: 2,
        maxSerializedBytes: 1_000_000
      })).rejects.toThrow(/course limit/i)
      expect((await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })).version).toBe(1)
    } finally {
      releaseBlocker()
      await blocker
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS snapshot_test_block_trigger ON "CatalogSnapshot"')
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS snapshot_test_block()')
    }
  })

  it('does not block another term mutation while one term snapshot is in flight', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])
    await prisma.term.create({
      data: {
        id: 'WI27', name: 'Winter Quarter 2027', active: true,
        startsAt: new Date('2027-01-04'), endsAt: new Date('2027-03-12')
      }
    })
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS snapshot_test_block_trigger ON "CatalogSnapshot"')
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION snapshot_test_block() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock(91234567);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER snapshot_test_block_trigger
      BEFORE INSERT OR UPDATE ON "CatalogSnapshot"
      FOR EACH ROW EXECUTE FUNCTION snapshot_test_block()
    `)

    let releaseBlocker!: () => void
    const release = new Promise<void>(resolve => { releaseBlocker = resolve })
    let blockerReady!: () => void
    const ready = new Promise<void>(resolve => { blockerReady = resolve })
    const blocker = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_lock(91234567) IS NULL AS locked`
      blockerReady()
      await release
      await tx.$queryRaw`SELECT pg_advisory_unlock(91234567) AS unlocked`
    })
    await ready

    try {
      const build = buildSnapshot('FA26', provenance)
      await vi.waitFor(async () => {
        const waits = await prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted
        `
        expect(Number(waits[0]?.count ?? 0)).toBeGreaterThan(0)
      })

      const winterCourse = makeCourse({
        id: 'WI27:CSE:120', number: '120', title: 'Winter course', sections: []
      })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await expect(Promise.race([
          upsertDepartment('WI27', 'CSE', [winterCourse]),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => reject(new Error('cross-term mutation blocked')), 500)
          })
        ])).resolves.toMatchObject({ coursesUpserted: 1 })
      } finally {
        if (timeout) clearTimeout(timeout)
      }

      releaseBlocker()
      await expect(build).resolves.toEqual({ version: 1 })
    } finally {
      releaseBlocker()
      await blocker
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS snapshot_test_block_trigger ON "CatalogSnapshot"')
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS snapshot_test_block()')
    }
  })
})
