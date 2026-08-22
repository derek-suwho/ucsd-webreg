import type { MeetingType } from '@webreg/db'
import type { NormalizedCourse } from './normalize.js'
import { withTermCatalogTransaction, type CatalogTransaction } from './term-transaction.js'

export type UpsertDepartmentResult = { coursesUpserted: number; sectionsCancelled: number }

export type SeatSnapshotInput = { id: string; available: number | null; waitlisted: number | null }
export type SeatUpdateInput = SeatSnapshotInput & { capacity: number | null }

/**
 * Diff + upsert one department's worth of scraped courses for a term.
 * Runs in a single transaction: upserts each Course, upserts its Sections,
 * replaces each Section's Meetings/Exams wholesale (no identity worth diffing),
 * and marks Sections present in the term/department but absent from `courses`
 * as cancelled (never deletes them — history/schedules may reference them).
 */
export async function upsertDepartment(
  termId: string,
  department: string,
  courses: NormalizedCourse[]
): Promise<UpsertDepartmentResult> {
  const courseIds = new Set<string>()
  const sectionIds = new Set<string>()
  for (const course of courses) {
    if (courseIds.has(course.id)) {
      throw new Error(`Duplicate course ID ${course.id}`)
    }
    courseIds.add(course.id)
    if (course.subject !== department) {
      throw new Error(`Course ${course.id} does not belong to department ${department}`)
    }
    if (course.id !== `${termId}:${course.subject}:${course.number}`) {
      throw new Error(`Course ${course.id} does not belong to term ${termId}`)
    }
    for (const section of course.sections) {
      if (section.id !== `${course.id}:${section.sectionCode}`) {
        throw new Error(`Section ${section.id} does not belong to course ${course.id}`)
      }
      if (sectionIds.has(section.id)) {
        throw new Error(`Duplicate section ID ${section.id}`)
      }
      sectionIds.add(section.id)
    }
  }

  return withTermCatalogTransaction(termId, async tx => {
      let coursesUpserted = 0
      let sectionsCancelled = 0

      const allSectionIds: string[] = []
      const allMeetings: {
        sectionId: string
        type: MeetingType
        days: string | null
        startMin: number | null
        endMin: number | null
        building: string | null
        room: string | null
      }[] = []
      const allExams: {
        sectionId: string
        type: 'FI' | 'MI'
        date: Date
        startMin: number
        endMin: number
        building: string | null
        room: string | null
      }[] = []

      for (const course of courses) {
        await tx.course.upsert({
          where: { id: course.id },
          create: {
            id: course.id,
            termId,
            subject: course.subject,
            number: course.number,
            title: course.title,
            unitsFrom: course.unitsFrom,
            unitsTo: course.unitsTo,
            unitsInc: course.unitsInc,
            restriction: course.restriction,
            note: course.note ?? null
          },
          update: {
            subject: course.subject,
            number: course.number,
            title: course.title,
            unitsFrom: course.unitsFrom,
            unitsTo: course.unitsTo,
            unitsInc: course.unitsInc,
            restriction: course.restriction,
            note: course.note ?? null
          }
        })
        coursesUpserted++

        const seenSectionIds: string[] = []

        for (const section of course.sections) {
          seenSectionIds.push(section.id)
          allSectionIds.push(section.id)

          await tx.section.upsert({
            where: { id: section.id },
            create: {
              id: section.id,
              courseId: course.id,
              sectionCode: section.sectionCode,
              familyCode: section.familyCode,
              registrationNumber: section.registrationNumber,
              instructor: section.instructor,
              capacity: section.capacity,
              available: section.available,
              waitlisted: section.waitlisted,
              isCancelled: section.isCancelled,
              note: section.note ?? null
            },
            update: {
              sectionCode: section.sectionCode,
              familyCode: section.familyCode,
              registrationNumber: section.registrationNumber,
              instructor: section.instructor,
              capacity: section.capacity,
              available: section.available,
              waitlisted: section.waitlisted,
              isCancelled: section.isCancelled,
              note: section.note ?? null
            }
          })

          for (const m of section.meetings) {
            allMeetings.push({
              sectionId: section.id,
              type: m.type as MeetingType,
              days: m.days,
              startMin: m.startMin,
              endMin: m.endMin,
              building: m.building,
              room: m.room
            })
          }

          for (const e of section.exams) {
            allExams.push({
              sectionId: section.id,
              type: e.type,
              date: new Date(e.date),
              startMin: e.startMin,
              endMin: e.endMin,
              building: e.building,
              room: e.room
            })
          }
        }

        const missingWhere =
          seenSectionIds.length > 0
            ? { courseId: course.id, id: { notIn: seenSectionIds }, isCancelled: false }
            : { courseId: course.id, isCancelled: false }

        const { count } = await tx.section.updateMany({
          where: missingWhere,
          data: { isCancelled: true }
        })
        sectionsCancelled += count
      }

      if (allSectionIds.length > 0) {
        await tx.meeting.deleteMany({ where: { sectionId: { in: allSectionIds } } })
        await tx.exam.deleteMany({ where: { sectionId: { in: allSectionIds } } })
      }
      if (allMeetings.length > 0) {
        await tx.meeting.createMany({ data: allMeetings })
      }
      if (allExams.length > 0) {
        await tx.exam.createMany({ data: allExams })
      }

      const seenCourseIds = courses.map(course => course.id)
      const absentCourseWhere = {
        course: {
          termId,
          subject: department,
          ...(seenCourseIds.length > 0 ? { id: { notIn: seenCourseIds } } : {})
        },
        isCancelled: false
      }
      const { count } = await tx.section.updateMany({
        where: absentCourseWhere,
        data: { isCancelled: true }
      })
      sectionsCancelled += count

      return { coursesUpserted, sectionsCancelled }
    })
}

async function recordSeatSnapshotsInTransaction(
  tx: CatalogTransaction,
  sections: SeatSnapshotInput[]
): Promise<number> {
  let written = 0
  for (const section of sections) {
    const latest = await tx.seatSnapshot.findFirst({
      where: { sectionId: section.id },
      orderBy: { at: 'desc' }
    })
    if (!latest || latest.available !== section.available || latest.waitlisted !== section.waitlisted) {
      await tx.seatSnapshot.create({
        data: {
          sectionId: section.id,
          at: new Date(),
          available: section.available,
          waitlisted: section.waitlisted
        }
      })
      written++
    }
  }
  return written
}

/**
 * Appends a SeatSnapshot row per section only when it differs from the latest
 * recorded snapshot (or none exists yet). Returns the number of rows written.
 */
export async function recordSeatSnapshots(
  termId: string,
  sections: SeatSnapshotInput[]
): Promise<number> {
  return withTermCatalogTransaction(termId, async tx => {
    const owned = await tx.section.count({
      where: { id: { in: sections.map(section => section.id) }, course: { termId } }
    })
    if (owned !== new Set(sections.map(section => section.id)).size) {
      throw new Error(`Seat snapshot sections do not belong to term ${termId}`)
    }
    return recordSeatSnapshotsInTransaction(tx, sections)
  })
}

/** Updates live seat fields and their history atomically under the shared term lock. */
export async function updateSeatsAndRecordSnapshots(
  termId: string,
  sections: SeatUpdateInput[]
): Promise<{ changed: boolean; snapshotsWritten: number }> {
  if (sections.length === 0) return { changed: false, snapshotsWritten: 0 }
  return withTermCatalogTransaction(termId, async tx => {
    const existing = await tx.section.findMany({
      where: { id: { in: sections.map(section => section.id) }, course: { termId } },
      select: { id: true, capacity: true, available: true, waitlisted: true }
    })
    const existingById = new Map(existing.map(section => [section.id, section]))
    let changed = false
    const present: SeatUpdateInput[] = []
    for (const section of sections) {
      const current = existingById.get(section.id)
      if (!current) continue
      present.push(section)
      if (
        current.capacity !== section.capacity ||
        current.available !== section.available ||
        current.waitlisted !== section.waitlisted
      ) {
        changed = true
        await tx.section.update({
          where: { id: section.id },
          data: {
            capacity: section.capacity,
            available: section.available,
            waitlisted: section.waitlisted
          }
        })
      }
    }
    const snapshotsWritten = await recordSeatSnapshotsInTransaction(tx, present)
    return { changed, snapshotsWritten }
  })
}
