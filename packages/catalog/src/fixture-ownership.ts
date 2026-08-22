import { prisma } from '@webreg/db'
import type { NormalizedCourse } from './normalize.js'

export type ExpectedFixtureOwnership = {
  courseIds: string[]
  sections: Array<{ id: string; courseId: string }>
}

export class FixtureOwnershipError extends Error {
  constructor(kind: 'course' | 'section' | 'section parent', termId: string, ids: string[]) {
    super(`Unexpected ${termId} ${kind} IDs: ${ids.join(', ')}; demo import aborted`)
    this.name = 'FixtureOwnershipError'
  }
}

export function expectedFixtureOwnership(
  departments: ReadonlyArray<{ courses: readonly NormalizedCourse[] }>
): ExpectedFixtureOwnership {
  return {
    courseIds: departments.flatMap(({ courses }) => courses.map(course => course.id)).sort(),
    sections: departments.flatMap(({ courses }) => courses.flatMap(course =>
      course.sections.map(section => ({ id: section.id, courseId: course.id }))
    )).sort((a, b) => a.id.localeCompare(b.id))
  }
}

export function validateFixtureOwnershipRows(
  termId: string,
  expected: ExpectedFixtureOwnership,
  courses: Array<{ id: string }>,
  sections: Array<{ id: string; courseId: string }>
): void {
  const expectedCourses = new Set(expected.courseIds)
  const expectedSections = new Map(expected.sections.map(section => [section.id, section.courseId]))
  const actualCourses = new Set(courses.map(course => course.id))
  const actualSections = new Map(sections.map(section => [section.id, section.courseId]))
  const courseDiff = [...new Set([
    ...courses.map(course => course.id).filter(id => !expectedCourses.has(id)),
    ...expected.courseIds.filter(id => !actualCourses.has(id))
  ])].sort()
  if (courseDiff.length > 0) throw new FixtureOwnershipError('course', termId, courseDiff)
  const sectionDiff = [...new Set([
    ...sections.map(section => section.id).filter(id => !expectedSections.has(id)),
    ...expected.sections.map(section => section.id).filter(id => !actualSections.has(id))
  ])].sort()
  if (sectionDiff.length > 0) throw new FixtureOwnershipError('section', termId, sectionDiff)
  const wrongParents = sections
    .filter(section => expectedSections.get(section.id) !== section.courseId)
    .map(section => section.id)
    .sort()
  if (wrongParents.length > 0) throw new FixtureOwnershipError('section parent', termId, wrongParents)
}

/** Prevents a demo snapshot from claiming catalog rows not owned by the fixture. */
export async function assertFixtureCatalogOwnership(
  termId: string,
  departments: ReadonlyArray<{ courses: readonly NormalizedCourse[] }>
): Promise<void> {
  const expected = expectedFixtureOwnership(departments)
  const [courses, sections] = await Promise.all([
    prisma.course.findMany({ where: { termId }, select: { id: true } }),
    prisma.section.findMany({ where: { course: { termId } }, select: { id: true, courseId: true } })
  ])
  const expectedCourses = new Set(expected.courseIds)
  const expectedSections = new Map(expected.sections.map(section => [section.id, section.courseId]))
  const unexpectedCourses = courses.map(({ id }) => id).filter(id => !expectedCourses.has(id)).sort()
  if (unexpectedCourses.length > 0) throw new FixtureOwnershipError('course', termId, unexpectedCourses)
  const unexpectedSections = sections.map(({ id }) => id).filter(id => !expectedSections.has(id)).sort()
  if (unexpectedSections.length > 0) throw new FixtureOwnershipError('section', termId, unexpectedSections)
  const wrongParents = sections
    .filter(section => expectedSections.get(section.id) !== section.courseId)
    .map(section => section.id)
    .sort()
  if (wrongParents.length > 0) throw new FixtureOwnershipError('section parent', termId, wrongParents)
}
