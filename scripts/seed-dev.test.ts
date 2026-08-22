import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { prisma } from '@webreg/db'
import { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

async function runSeed(): Promise<void> {
  await execFileAsync('npm', ['run', 'seed:demo'], {
    cwd: repoRoot,
    env: process.env,
    timeout: 30_000
  })
}

describe.skipIf(!process.env.DATABASE_URL)('seed:demo', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ImportRun", "CatalogSnapshot", "SeatSnapshot", "Exam", "Meeting", "ScheduleItem", "Schedule", "Section", "Course", "User", "Term" RESTART IDENTITY CASCADE'
    )
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('seeds a fresh database through the fixture pipeline', async () => {
    await runSeed()

    const courseIds = (await prisma.course.findMany({ orderBy: { id: 'asc' }, select: { id: true } }))
      .map(course => course.id)
    const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    const data = snapshot.data as Record<string, unknown>

    expect(courseIds).toEqual(['FA26:DEMO:101', 'FA26:DEMO:280', 'FA26:LABX:150'])
    expect(snapshot.version).toBe(1)
    expect(data.provenance).toEqual({
      sourceKind: 'fixture',
      mode: 'demo',
      sourceGeneratedAt: '2026-08-21T00:00:00.000Z'
    })
  })

  it('keeps fixture payload deterministic on a repeated seed', async () => {
    await runSeed()
    const first = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await runSeed()
    const second = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    const { version: _firstVersion, generatedAt: _firstGeneratedAt, ...firstStable } = first.data as Record<string, unknown>
    const { version: _secondVersion, generatedAt: _secondGeneratedAt, ...secondStable } = second.data as Record<string, unknown>

    expect(second.version).toBe(2)
    expect(secondStable).toEqual(firstStable)
  })

  it('replaces unexpected meetings and exams under expected sections', async () => {
    await runSeed()
    await prisma.meeting.create({
      data: {
        sectionId: 'FA26:DEMO:101:A01',
        type: 'OT',
        days: 'S',
        startMin: 480,
        endMin: 540,
        building: 'ROGUE',
        room: '1'
      }
    })
    await prisma.exam.create({
      data: {
        sectionId: 'FA26:DEMO:101:A01',
        type: 'MI',
        date: new Date('2026-11-01'),
        startMin: 480,
        endMin: 540,
        building: 'ROGUE',
        room: '1'
      }
    })

    await runSeed()

    await expect(prisma.meeting.count({ where: {
      sectionId: 'FA26:DEMO:101:A01', type: 'OT'
    } })).resolves.toBe(0)
    await expect(prisma.exam.count({ where: {
      sectionId: 'FA26:DEMO:101:A01', type: 'MI'
    } })).resolves.toBe(0)
  })

  it('rejects unexpected FA26 courses without replacing the snapshot', async () => {
    await runSeed()
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await prisma.course.create({
      data: {
        id: 'FA26:ROGUE:1',
        termId: 'FA26',
        subject: 'ROGUE',
        number: '1',
        title: 'Unexpected course',
        unitsFrom: 4,
        unitsTo: 4,
        unitsInc: 0,
        restriction: []
      }
    })

    await expect(runSeed()).rejects.toThrow(/fixture_ownership_failed/i)
    const after = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect(after).toEqual(before)
  })

  it('rejects unexpected FA26 sections without replacing the snapshot', async () => {
    await runSeed()
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await prisma.section.create({
      data: {
        id: 'FA26:DEMO:101:Z99',
        courseId: 'FA26:DEMO:101',
        sectionCode: 'Z99',
        familyCode: 'Z',
        meetings: {
          create: {
            type: 'OT',
            days: 'S',
            startMin: 480,
            endMin: 540,
            building: 'ROGUE',
            room: '1'
          }
        },
        exams: {
          create: {
            type: 'MI',
            date: new Date('2026-11-01'),
            startMin: 480,
            endMin: 540,
            building: 'ROGUE',
            room: '1'
          }
        }
      }
    })

    await expect(runSeed()).rejects.toThrow(/fixture_ownership_failed/i)
    const after = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    expect(after).toEqual(before)
  })

  it('fails without publishing when the catalog advisory lock is held', async () => {
    await runSeed()
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    const runsBefore = await prisma.importRun.count()
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      const acquired = await client.query(
        'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS acquired',
        ['catalog-write', 'FA26']
      )
      expect(acquired.rows[0].acquired).toBe(true)

      await expect(runSeed()).rejects.toThrow(/catalog_lock_skipped/i)
    } finally {
      await client.query(
        'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
        ['catalog-write', 'FA26']
      )
      await client.end()
    }

    expect(await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })).toEqual(before)
    expect(await prisma.importRun.count()).toBe(runsBefore)
  })
})
