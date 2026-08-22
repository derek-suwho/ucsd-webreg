import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@webreg/db'
import type { NormalizedCourse } from './normalize.js'
import { upsertDepartment, recordSeatSnapshots } from './repo.js'

describe.skipIf(!process.env.DATABASE_URL)('repo', () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SeatSnapshot", "Exam", "Meeting", "Section", "Course", "Term" RESTART IDENTITY CASCADE'
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
        },
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
        }
      ],
      ...overrides
    }
  }

  function courseFor(subject: string, number: string, termId = 'FA26'): NormalizedCourse {
    const id = `${termId}:${subject}:${number}`
    return makeCourse({
      id,
      subject,
      number,
      title: `${subject} ${number}`,
      sections: [{
        ...makeCourse().sections[0],
        id: `${id}:A00`
      }]
    })
  }

  it('upserts course + sections + meetings/exams', async () => {
    const result = await upsertDepartment('FA26', 'CSE', [makeCourse()])
    expect(result.coursesUpserted).toBe(1)
    expect(result.sectionsCancelled).toBe(0)

    const dbCourse = await prisma.course.findUnique({ where: { id: 'FA26:CSE:110' } })
    expect(dbCourse).not.toBeNull()

    const sections = await prisma.section.findMany({ where: { courseId: 'FA26:CSE:110' } })
    expect(sections).toHaveLength(2)

    const meetings = await prisma.meeting.findMany({ where: { sectionId: 'FA26:CSE:110:A00' } })
    expect(meetings).toHaveLength(1)

    const exams = await prisma.exam.findMany({ where: { sectionId: 'FA26:CSE:110:A01' } })
    expect(exams).toHaveLength(1)
  })

  it('re-upsert with a missing section marks it isCancelled, does not delete it', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])

    const c = makeCourse()
    c.sections = c.sections.slice(0, 1) // drop A01
    const result = await upsertDepartment('FA26', 'CSE', [c])
    expect(result.sectionsCancelled).toBe(1)

    const sections = await prisma.section.findMany({ where: { courseId: 'FA26:CSE:110' } })
    expect(sections).toHaveLength(2) // still present, not deleted

    const a01 = sections.find(s => s.id === 'FA26:CSE:110:A01')!
    expect(a01.isCancelled).toBe(true)
    const a00 = sections.find(s => s.id === 'FA26:CSE:110:A00')!
    expect(a00.isCancelled).toBe(false)
  })

  it('cancels sections for courses absent from a completed department only', async () => {
    const cse110 = courseFor('CSE', '110')
    const cse120 = courseFor('CSE', '120')
    const math20 = courseFor('MATH', '20')
    await upsertDepartment('FA26', 'CSE', [cse110, cse120])
    await upsertDepartment('FA26', 'MATH', [math20])

    const user = await prisma.user.upsert({
      where: { email: 'planner@example.test' },
      create: { email: 'planner@example.test' },
      update: {}
    })
    const schedule = await prisma.schedule.create({
      data: { userId: user.id, termId: 'FA26', name: 'Plan' }
    })
    await prisma.scheduleItem.create({
      data: { scheduleId: schedule.id, sectionId: cse120.sections[0].id, status: 'planned' }
    })

    const result = await upsertDepartment('FA26', 'CSE', [cse110])

    expect(result.sectionsCancelled).toBe(1)
    expect(await prisma.section.findUniqueOrThrow({ where: { id: cse110.sections[0].id } }))
      .toMatchObject({ isCancelled: false })
    expect(await prisma.section.findUniqueOrThrow({ where: { id: cse120.sections[0].id } }))
      .toMatchObject({ isCancelled: true })
    expect(await prisma.section.findUniqueOrThrow({ where: { id: math20.sections[0].id } }))
      .toMatchObject({ isCancelled: false })
    expect(await prisma.scheduleItem.findMany({ where: { scheduleId: schedule.id } })).toHaveLength(1)
  })

  it('empty completed department cancels that department only', async () => {
    const cse110 = courseFor('CSE', '110')
    const cse120 = courseFor('CSE', '120')
    const math20 = courseFor('MATH', '20')
    const winterCse = courseFor('CSE', '130', 'WI27')
    await prisma.term.create({
      data: {
        id: 'WI27',
        name: 'Winter Quarter 2027',
        active: true,
        startsAt: new Date('2027-01-04'),
        endsAt: new Date('2027-03-12')
      }
    })
    await upsertDepartment('FA26', 'CSE', [cse110, cse120])
    await upsertDepartment('FA26', 'MATH', [math20])
    await upsertDepartment('WI27', 'CSE', [winterCse])

    const result = await upsertDepartment('FA26', 'CSE', [])

    expect(result).toEqual({ coursesUpserted: 0, sectionsCancelled: 2 })
    expect(await prisma.section.count({
      where: { course: { termId: 'FA26', subject: 'CSE' }, isCancelled: true }
    })).toBe(2)
    expect(await prisma.section.findUniqueOrThrow({ where: { id: math20.sections[0].id } }))
      .toMatchObject({ isCancelled: false })
    expect(await prisma.section.findUniqueOrThrow({ where: { id: winterCse.sections[0].id } }))
      .toMatchObject({ isCancelled: false })
  })

  it('rejects mismatched term or department before mutation', async () => {
    const existing = courseFor('CSE', '110')
    await upsertDepartment('FA26', 'CSE', [existing])
    const mismatchedDepartment = courseFor('MATH', '20')
    const mismatchedTerm = { ...courseFor('CSE', '120'), id: 'WI27:CSE:120' }

    await expect(upsertDepartment('FA26', 'CSE', [mismatchedDepartment]))
      .rejects.toThrow(/department/i)
    await expect(upsertDepartment('FA26', 'CSE', [mismatchedTerm]))
      .rejects.toThrow(/term/i)

    expect(await prisma.course.count()).toBe(1)
    expect(await prisma.section.findUniqueOrThrow({ where: { id: existing.sections[0].id } }))
      .toMatchObject({ isCancelled: false })
  })

  it('rejects a foreign section ID before mutating its row or children', async () => {
    const foreign = courseFor('MATH', '20')
    foreign.sections[0].exams = [{
      type: 'FI',
      date: '2026-12-08',
      startMin: 600,
      endMin: 720,
      building: 'EXAM',
      room: '1'
    }]
    await upsertDepartment('FA26', 'MATH', [foreign])
    const before = await prisma.course.findMany({
      include: { sections: { include: { meetings: true, exams: true } } },
      orderBy: { id: 'asc' }
    })
    const incoming = courseFor('CSE', '110')
    incoming.sections[0].id = foreign.sections[0].id

    await expect(upsertDepartment('FA26', 'CSE', [incoming]))
      .rejects.toThrow(/section.*course/i)

    expect(await prisma.course.findMany({
      include: { sections: { include: { meetings: true, exams: true } } },
      orderBy: { id: 'asc' }
    })).toEqual(before)
  })

  it('rejects duplicate course and section IDs before mutation', async () => {
    const course = makeCourse()
    await expect(upsertDepartment('FA26', 'CSE', [course, structuredClone(course)]))
      .rejects.toThrow(/duplicate course/i)

    const duplicateSectionCourse = makeCourse()
    duplicateSectionCourse.sections.push(structuredClone(duplicateSectionCourse.sections[0]))
    await expect(upsertDepartment('FA26', 'CSE', [duplicateSectionCourse]))
      .rejects.toThrow(/duplicate section/i)

    expect(await prisma.course.count()).toBe(0)
    expect(await prisma.section.count()).toBe(0)
  })

  it('recordSeatSnapshots dedupes: unchanged values on second call write 0 rows', async () => {
    await upsertDepartment('FA26', 'CSE', [makeCourse()])
    const secs = [{ id: 'FA26:CSE:110:A01', available: 10, waitlisted: 0 }]

    const first = await recordSeatSnapshots('FA26', secs)
    expect(first).toBe(1)

    const second = await recordSeatSnapshots('FA26', secs)
    expect(second).toBe(0)

    const changed = await recordSeatSnapshots('FA26', [{ id: 'FA26:CSE:110:A01', available: 5, waitlisted: 0 }])
    expect(changed).toBe(1)

    const snapshots = await prisma.seatSnapshot.findMany({ where: { sectionId: 'FA26:CSE:110:A01' } })
    expect(snapshots).toHaveLength(2)
  })
})
