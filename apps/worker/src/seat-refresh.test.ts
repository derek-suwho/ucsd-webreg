import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@webreg/db'
import { upsertDepartment, type NormalizedCourse } from '@webreg/catalog'
import { seatRefresh } from './seat-refresh.js'

const SECTION_ID = 'FA26:SOC:1:A01'

const course = (available: number): NormalizedCourse => ({
  id: 'FA26:SOC:1',
  subject: 'SOC',
  number: '1',
  title: 'Introduction to Sociology',
  unitsFrom: 4,
  unitsTo: 4,
  unitsInc: 0,
  restriction: [],
  sections: [
    {
      id: SECTION_ID,
      sectionCode: 'A01',
      familyCode: 'A',
      registrationNumber: 59266,
      instructor: 'John Smith',
      capacity: 20,
      available,
      waitlisted: null,
      isCancelled: false,
      meetings: [],
      exams: []
    }
  ]
})

const soupPage = (available: number): string => `<html>
<body>
<form id="socDisplayCVO" name="socDisplayCVO">
<table>
<tr><td align="left">SOC</td><td align="right">(1 of 1)</td></tr>
</table>
<table class="tbrdr">
<tbody>
<tr><td>ignored header tbody</td></tr>
</tbody>
<tbody>
<tr><td colspan="13"><h2>Sociology&nbsp;(SOC&nbsp;)</h2></td></tr>
<tr><td class="ubrdr">Enrl</td><td class="ubrdr">Sect</td><td class="ubrdr">Type</td></tr>
<tr>
  <td class="crsheader"></td>
  <td class="crsheader">1</td>
  <td class="crsheader">Introduction to Sociology ( 4 Units) An introduction to the discipline of sociology.</td>
  <td class="crsheader"><a href="#">catalog</a></td>
</tr>
<tr class="sectxt">
  <td></td>
  <td></td>
  <td>059266</td>
  <td>DI</td>
  <td>A01</td>
  <td>Tu</td>
  <td>2:00p-2:50p</td>
  <td>CENTR</td>
  <td>119</td>
  <td><a href="#">Smith, John</a></td>
  <td>${available}</td>
  <td>20</td>
  <td></td>
</tr>
</tbody>
</table>
</form>
</body>
</html>`

describe.skipIf(!process.env.DATABASE_URL)('seatRefresh', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ImportRun", "CatalogSnapshot", "SeatSnapshot", "Exam", "Meeting", "Section", "Course", "Term" RESTART IDENTITY CASCADE'
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
    await upsertDepartment('FA26', 'SOC', [course(5)])
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('updates only seat fields, records a snapshot, and bumps the catalog version', async () => {
    const fetcher = {
      fetchDepartmentList: async (_termId: string) => ['SOC'],
      fetchResultPage: async (_termId: string, _depts: string[], _page: number) => soupPage(3)
    }

    await seatRefresh(fetcher, 'FA26')

    const section = await prisma.section.findUniqueOrThrow({ where: { id: SECTION_ID } })
    expect(section.available).toBe(3)
    expect(section.capacity).toBe(20)

    const snapshots = await prisma.seatSnapshot.findMany({ where: { sectionId: SECTION_ID } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].available).toBe(3)

    const snapshotAfterFirst = await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })
    expect(snapshotAfterFirst).not.toBeNull()
    expect(snapshotAfterFirst!.version).toBe(1)

    const run = await prisma.importRun.findFirstOrThrow({ where: { termId: 'FA26' } })
    expect(run.kind).toBe('seats')
    expect(run.okDepts).toEqual(['SOC'])

    // Second run, same data: no new snapshot rows, version unchanged.
    await seatRefresh(fetcher, 'FA26')

    const section2 = await prisma.section.findUniqueOrThrow({ where: { id: SECTION_ID } })
    expect(section2.available).toBe(3)

    const snapshotsAfterSecond = await prisma.seatSnapshot.findMany({ where: { sectionId: SECTION_ID } })
    expect(snapshotsAfterSecond).toHaveLength(1)

    const snapshotAfterSecond = await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })
    expect(snapshotAfterSecond!.version).toBe(1)
  })

  it('cold-start: writes baseline snapshot without bumping version when no seats changed', async () => {
    // First run: actual seat change (5->3) to initialize snapshot
    const fetcher = {
      fetchDepartmentList: async (_termId: string) => ['SOC'],
      fetchResultPage: async (_termId: string, _depts: string[], _page: number) => soupPage(3)
    }

    await seatRefresh(fetcher, 'FA26')

    const snapshotAfterFirst = await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })
    expect(snapshotAfterFirst!.version).toBe(1)

    // Delete snapshot history to simulate cold-start (section exists in DB but no SeatSnapshot history)
    await prisma.seatSnapshot.deleteMany({ where: { sectionId: SECTION_ID } })

    // Second run: same values (available=3), no actual seat change
    await seatRefresh(fetcher, 'FA26')

    // Assert: baseline snapshot IS written
    const snapshotsAfterColdStart = await prisma.seatSnapshot.findMany({ where: { sectionId: SECTION_ID } })
    expect(snapshotsAfterColdStart).toHaveLength(1)
    expect(snapshotsAfterColdStart[0].available).toBe(3)

    // Assert: CatalogSnapshot version NOT bumped (baseline snapshot ≠ catalog change)
    const snapshotAfterColdStart = await prisma.catalogSnapshot.findUnique({ where: { termId: 'FA26' } })
    expect(snapshotAfterColdStart!.version).toBe(1)
  })

  it('stores only a stable category for arbitrary fatal source errors', async () => {
    const failure = new Error('user@example.edu session-abc {"private":"value"} unkeyed-secret')
    const fetcher = {
      fetchDepartmentList: async (_termId: string) => { throw failure },
      fetchResultPage: async () => ''
    }

    await expect(seatRefresh(fetcher, 'FA26')).rejects.toMatchObject({ category: 'department_list_failed' })

    const run = await prisma.importRun.findFirstOrThrow({ where: { termId: 'FA26' } })
    expect(run.error).toBe('department_list_failed')
    expect([run.error, ...run.okDepts, ...run.failedDepts].join(' ')).not.toContain(failure.message)
  })

  it('rejects a prefetch partial without seat mutation or snapshot publication', async () => {
    const fetcher = {
      fetchDepartmentList: async () => ['SOC', 'BAD'],
      fetchResultPage: async (_termId: string, departments: string[]) =>
        departments[0] === 'SOC' ? soupPage(3) : '<html>bad</html>'
    }
    await expect(seatRefresh(fetcher, 'FA26')).rejects.toMatchObject({ category: 'department_sync_failed' })
    expect((await prisma.section.findUniqueOrThrow({ where: { id: SECTION_ID } })).available).toBe(5)
    expect(await prisma.catalogSnapshot.count()).toBe(0)
    expect(await prisma.importRun.findFirstOrThrow()).toMatchObject({
      okDepts: [], failedDepts: ['BAD'], error: 'department_sync_failed'
    })
  })

  it('rejects apply failure without replacing last-good provenance', async () => {
    const fetcher = {
      fetchDepartmentList: async () => ['SOC'],
      fetchResultPage: async () => soupPage(3)
    }
    await seatRefresh(fetcher, 'FA26')
    const before = await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })
    await expect(seatRefresh(fetcher, 'FA26', {
      updateSeats: async () => { throw new Error('private database detail') }
    })).rejects.toMatchObject({ category: 'department_sync_failed' })
    expect(await prisma.catalogSnapshot.findUniqueOrThrow({ where: { termId: 'FA26' } })).toEqual(before)
  })

  it('rejects a successful refresh when completion recording fails', async () => {
    const fetcher = {
      fetchDepartmentList: async () => ['SOC'],
      fetchResultPage: async () => soupPage(5)
    }
    const update = vi.spyOn(prisma.importRun, 'update').mockRejectedValueOnce(new Error('write failed'))
    try {
      await expect(seatRefresh(fetcher, 'FA26')).rejects.toMatchObject({ category: 'catalog_write_failed' })
    } finally {
      update.mockRestore()
    }
  })

  it('preserves the source failure when completion recording also fails', async () => {
    const fetcher = { fetchDepartmentList: async () => { throw new Error('source failed') }, fetchResultPage: async () => '' }
    const update = vi.spyOn(prisma.importRun, 'update').mockRejectedValueOnce(new Error('write failed'))
    try {
      await expect(seatRefresh(fetcher, 'FA26')).rejects.toMatchObject({ category: 'department_list_failed' })
    } finally {
      update.mockRestore()
    }
  })
})
