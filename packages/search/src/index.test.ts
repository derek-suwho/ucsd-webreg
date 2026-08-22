import { describe, it, expect } from 'vitest'
import type { CatalogData, CatalogCourse, CatalogSection } from '@webreg/catalog'
import { buildIndex, searchCourses } from './index.js'

function course(overrides: Partial<CatalogCourse> & { id: string; subject: string; number: string; title: string; sectionIds: string[] }): CatalogCourse {
  return { unitsFrom: 4, unitsTo: 4, unitsInc: 0, ...overrides }
}

function section(overrides: Partial<CatalogSection> & { id: string; courseId: string }): CatalogSection {
  return {
    code: 'A00', family: 'LE', regNum: null, instructor: null,
    cap: null, avail: null, wait: null, cancelled: false,
    meetings: [], exams: [],
    ...overrides
  }
}

function toyCatalog(): CatalogData {
  const courses = [
    course({ id: 'CSE110', subject: 'CSE', number: '110', title: 'Software Engineering', sectionIds: ['S1'] }),
    course({ id: 'CSE8A', subject: 'CSE', number: '8A', title: 'Intro to Programming', sectionIds: ['S2'] }),
    course({ id: 'CSE12', subject: 'CSE', number: '12', title: 'Basic Data Structures', sectionIds: ['S3'] }),
    course({ id: 'MATH20A', subject: 'MATH', number: '20A', title: 'Calculus for Science and Engineering', sectionIds: ['S4'] }),
    course({ id: 'TST1', subject: 'TST', number: '1', title: 'Tst1 Fundamentals', sectionIds: ['S5'] })
  ]
  const sections = [
    section({ id: 'S1', courseId: 'CSE110', regNum: 59266, instructor: 'Smith, John' }),
    section({ id: 'S2', courseId: 'CSE8A', regNum: 111111, instructor: 'Lee, Amy' }),
    section({ id: 'S3', courseId: 'CSE12', regNum: 222222, instructor: 'Nguyen, Bao' }),
    section({ id: 'S4', courseId: 'MATH20A', regNum: 333333, instructor: 'Anderson, Jane' }),
    section({ id: 'S5', courseId: 'TST1', regNum: 555555, instructor: 'Baker, Sam' })
  ]
  return {
    termId: 'FA26', version: 1, generatedAt: '2026-01-01T00:00:00Z',
    courses: Object.fromEntries(courses.map(c => [c.id, c])),
    sections: Object.fromEntries(sections.map(s => [s.id, s]))
  }
}

describe('searchCourses', () => {
  const index = buildIndex(toyCatalog())

  it('exact "SUBJ NUM" ranks first for "cse 110"', () => {
    const results = searchCourses(index, 'cse 110')
    expect(results[0]).toBe('CSE110')
  })

  it('exact match works for compact "cse110"', () => {
    const results = searchCourses(index, 'cse110')
    expect(results[0]).toBe('CSE110')
  })

  it('matches a 6-digit registration number to its owning course', () => {
    expect(searchCourses(index, '059266')).toEqual(['CSE110'])
  })

  it('matches title words by prefix', () => {
    expect(searchCourses(index, 'data structures')).toEqual(['CSE12'])
  })

  it('matches instructor last name by prefix', () => {
    expect(searchCourses(index, 'smith')).toEqual(['CSE110'])
  })

  it('returns [] for no matches', () => {
    expect(searchCourses(index, 'zzz')).toEqual([])
  })

  it('orders subject-prefix matches numeric-aware (8A < 12 < 110)', () => {
    expect(searchCourses(index, 'cse')).toEqual(['CSE8A', 'CSE12', 'CSE110'])
  })

  it('dedupes a course matched by multiple tiers, keeping the highest tier only', () => {
    const results = searchCourses(index, 'tst1')
    expect(results).toEqual(['TST1'])
  })

  it('respects the limit parameter', () => {
    expect(searchCourses(index, 'cse', 2)).toEqual(['CSE8A', 'CSE12'])
  })
})
