import type { CatalogCourse, CatalogData, CatalogSection } from './client-types.js'
import { catalogProvenanceSchema, type CatalogProvenance } from './source.js'
import { withTermCatalogTransaction } from './term-transaction.js'
import {
  validateFixtureOwnershipRows,
  type ExpectedFixtureOwnership
} from './fixture-ownership.js'

export const DEFAULT_SNAPSHOT_LIMITS = {
  maxCourses: 20_000,
  maxSections: 100_000,
  maxSerializedBytes: 32 * 1024 * 1024
} as const

export type SnapshotLimits = {
  maxCourses: number
  maxSections: number
  maxSerializedBytes: number
}

export class SnapshotLimitError extends Error {
  constructor(kind: string, actual: number, limit: number) {
    super(`Catalog snapshot ${kind} limit exceeded (${actual} > ${limit})`)
    this.name = 'SnapshotLimitError'
  }
}

function resolveLimits(overrides: Partial<SnapshotLimits>): SnapshotLimits {
  const limits = { ...DEFAULT_SNAPSHOT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid snapshot ${name} limit`)
    }
  }
  return limits
}

function assertWithinLimit(kind: string, actual: number, limit: number): void {
  if (actual > limit) {
    throw new SnapshotLimitError(kind, actual, limit)
  }
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Reads all courses/sections/meetings/exams for a term, builds the client-facing
 * CatalogData shape, and upserts a CatalogSnapshot row with an incremented version.
 */
export async function buildSnapshot(
  termId: string,
  provenance: CatalogProvenance,
  limitOverrides: Partial<SnapshotLimits> = {},
  options: {
    expectedFixtureOwnership?: ExpectedFixtureOwnership
    afterMaterialized?: () => Promise<void>
  } = {}
): Promise<{ version: number }> {
  const validatedProvenance = catalogProvenanceSchema.parse(provenance)
  const limits = resolveLimits(limitOverrides)
  const { version } = await withTermCatalogTransaction(termId, async tx => {
    const courseCount = await tx.course.count({ where: { termId } })
    const sectionCount = await tx.section.count({ where: { course: { termId } } })
    assertWithinLimit('course', courseCount, limits.maxCourses)
    assertWithinLimit('section', sectionCount, limits.maxSections)

    const dbCourses = await tx.course.findMany({
      where: { termId },
      include: {
        sections: {
          include: { meetings: true, exams: true }
        }
      }
    })
    await options.afterMaterialized?.()
    const courses: Record<string, CatalogCourse> = {}
    const sections: Record<string, CatalogSection> = {}

    for (const course of dbCourses) {
      const sortedSections = [...course.sections].sort((a, b) =>
        a.sectionCode < b.sectionCode ? -1 : a.sectionCode > b.sectionCode ? 1 : 0
      )
      courses[course.id] = {
        id: course.id,
        subject: course.subject,
        number: course.number,
        title: course.title,
        unitsFrom: course.unitsFrom,
        unitsTo: course.unitsTo,
        unitsInc: course.unitsInc,
        sectionIds: sortedSections.map(s => s.id)
      }
      for (const section of sortedSections) {
        sections[section.id] = {
          id: section.id,
          courseId: section.courseId,
          code: section.sectionCode,
          family: section.familyCode,
          regNum: section.registrationNumber,
          instructor: section.instructor,
          cap: section.capacity,
          avail: section.available,
          wait: section.waitlisted,
          cancelled: section.isCancelled,
          meetings: section.meetings.map(m => ({
            type: m.type,
            days: m.days,
            start: m.startMin,
            end: m.endMin,
            bldg: m.building,
            room: m.room
          })),
          exams: section.exams.map(e => ({
            type: e.type,
            date: toDateOnly(e.date),
            start: e.startMin,
            end: e.endMin
          }))
        }
      }
    }

    const existing = await tx.catalogSnapshot.findUnique({ where: { termId } })
    const version = (existing?.version ?? 0) + 1
    const generatedAt = new Date()

    const data: CatalogData = {
      termId,
      version,
      generatedAt: generatedAt.toISOString(),
      provenance: validatedProvenance,
      courses,
      sections
    }

    const serializedBytes = Buffer.byteLength(JSON.stringify(data), 'utf8')
    assertWithinLimit('serialized byte', serializedBytes, limits.maxSerializedBytes)

    const materializedCourseCount = dbCourses.length
    const materializedSections = dbCourses.flatMap(course => course.sections.map(section => ({
      id: section.id,
      courseId: section.courseId
    })))
    if (materializedCourseCount !== courseCount || materializedSections.length !== sectionCount) {
      throw new Error('Catalog changed while materializing snapshot')
    }
    assertWithinLimit('course', materializedCourseCount, limits.maxCourses)
    assertWithinLimit('section', materializedSections.length, limits.maxSections)
    if (options.expectedFixtureOwnership) {
      validateFixtureOwnershipRows(
        termId,
        options.expectedFixtureOwnership,
        dbCourses.map(course => ({ id: course.id })),
        materializedSections
      )
    }

    await tx.catalogSnapshot.upsert({
      where: { termId },
      create: { termId, version, generatedAt, data: data as object },
      update: { version, generatedAt, data: data as object }
    })

    return { version }
  })

  return { version }
}
