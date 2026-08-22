import { describe, expect, it } from 'vitest'
import type { ParsedRow } from './types.js'
import {
  catalogProvenanceSchema,
  catalogSourceKindSchema,
  flattenScrapedCourses,
  sourceTermSchema,
  type CatalogSource,
  type ScrapedCourse
} from './source.js'

const course: Extract<ParsedRow, { kind: 'course' }> = {
  kind: 'course',
  subject: 'CSE',
  number: '110',
  title: 'Software Engineering',
  units: { from: 4, to: 4, inc: 0 },
  restriction: []
}

const section: Extract<ParsedRow, { kind: 'section' }> = {
  kind: 'section',
  registrationNumber: 123456,
  meetingType: 'LE',
  sectionCode: 'A00',
  examDate: null,
  days: 'MWF',
  startMin: 600,
  endMin: 650,
  building: 'CENTR',
  room: '101',
  instructors: ['Ada Lovelace'],
  available: 10,
  capacity: 30,
  waitlisted: null,
  cancelled: false
}

const sourceTerm = {
  id: 'FA26',
  name: 'Fall Quarter 2026',
  startsAt: '2026-09-24',
  endsAt: '2026-12-04',
  departments: ['CSE'],
  sourceGeneratedAt: '2026-08-21T00:00:00.000Z'
}

describe('catalog source contract', () => {
  it.each(['fixture', 'legacy-soc', 'tss'] as const)('accepts %s as a source kind', (kind) => {
    const source: CatalogSource = {
      kind,
      knownTermIds: [],
      listTerms: async () => [],
      fetchDepartment: async () => []
    }

    expect(catalogSourceKindSchema.parse(source.kind)).toBe(kind)
  })

  it('keeps each course immediately before its own sections when flattened', () => {
    const secondCourse = { ...course, number: '120', title: 'Principles of Operating Systems' }
    const secondSection = { ...section, sectionCode: 'A01', registrationNumber: 654321 }
    const scraped: ScrapedCourse[] = [
      { course, sections: [section] },
      { course: secondCourse, sections: [secondSection] }
    ]

    expect(flattenScrapedCourses(scraped)).toEqual([course, section, secondCourse, secondSection])
  })

  it('rejects live provenance for fixture data', () => {
    expect(() => catalogProvenanceSchema.parse({
      sourceKind: 'fixture',
      mode: 'live',
      sourceGeneratedAt: '2026-08-21T00:00:00.000Z'
    })).toThrow(/fixture/i)
  })

  it.each([
    { ...sourceTerm, startsAt: '2026-02-30' },
    { ...sourceTerm, startsAt: '2026-12-05' }
  ])('rejects invalid or reversed term dates', (term) => {
    expect(() => sourceTermSchema.parse(term)).toThrow()
  })

  it('rejects duplicate departments', () => {
    expect(() => sourceTermSchema.parse({ ...sourceTerm, departments: ['CSE', 'CSE'] })).toThrow(/unique/i)
  })

  it.each([
    { ...sourceTerm, departments: [] },
    { ...sourceTerm, departments: [''] },
    { ...sourceTerm, departments: ['A'.repeat(33)] },
    { ...sourceTerm, departments: Array.from({ length: 257 }, (_, index) => `D${index}`) }
  ])('rejects empty or oversized department input', (term) => {
    expect(() => sourceTermSchema.parse(term)).toThrow()
  })
})
