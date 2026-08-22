import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FixtureCatalogSource } from './fixture-source.js'
import { flattenScrapedCourses } from './source.js'
import { normalizeDepartment, type NormalizedSection } from './normalize.js'

const fixtureUrl = new URL('../fixtures/fa26-demo.json', import.meta.url)

function readFixture(): unknown {
  return JSON.parse(readFileSync(fixtureUrl, 'utf8'))
}

async function normalizedSections(source: FixtureCatalogSource): Promise<{
  courses: Awaited<ReturnType<typeof normalizeFixtureDepartment>>['courses']
  sections: NormalizedSection[]
}> {
  const [term] = await source.listTerms()
  const courses = (
    await Promise.all(term.departments.map(department => normalizeFixtureDepartment(source, term.id, department)))
  ).flatMap(result => result.courses)
  return { courses, sections: courses.flatMap(course => course.sections) }
}

async function normalizeFixtureDepartment(source: FixtureCatalogSource, termId: string, department: string) {
  const scraped = await source.fetchDepartment(termId, department)
  return normalizeDepartment(flattenScrapedCourses(scraped), termId)
}

function overlaps(left: NormalizedSection, right: NormalizedSection): boolean {
  return left.meetings.some(a => right.meetings.some(b =>
    a.days !== null && a.days === b.days &&
    a.startMin !== null && a.endMin !== null && b.startMin !== null && b.endMin !== null &&
    a.startMin < b.endMin && b.startMin < a.endMin
  ))
}

function examsOverlap(left: NormalizedSection, right: NormalizedSection): boolean {
  return left.exams.some(a => right.exams.some(b =>
    a.date === b.date && a.startMin < b.endMin && b.startMin < a.endMin
  ))
}

describe('FixtureCatalogSource', () => {
  it('lists only the sanitized FA26 demo term', async () => {
    const source = new FixtureCatalogSource(readFixture())

    await expect(source.listTerms()).resolves.toEqual([{
      id: 'FA26',
      name: 'Fall Quarter 2026 Demo',
      startsAt: '2026-09-24',
      endsAt: '2026-12-04',
      departments: ['DEMO', 'LABX'],
      sourceGeneratedAt: '2026-08-21T00:00:00.000Z'
    }])
    expect(source.kind).toBe('fixture')
  })

  it('contains every planner edge without copied or personal data', async () => {
    const source = new FixtureCatalogSource(readFixture())
    const { courses, sections } = await normalizedSections(source)
    const meetingTypes = new Set(sections.flatMap(section => section.meetings.map(meeting => meeting.type)))

    expect([...meetingTypes]).toEqual(expect.arrayContaining(['LE', 'DI', 'LA']))
    expect(sections.some(section => section.meetings.some(meeting =>
      meeting.days === null && meeting.startMin === null && meeting.endMin === null &&
      meeting.building === null && meeting.room === null
    ))).toBe(true)
    expect(sections.some(section => section.exams.some(exam => exam.type === 'FI'))).toBe(true)
    expect(sections.some(section => section.isCancelled)).toBe(true)
    expect(sections.some(section => section.capacity !== null && (section.available ?? 0) > 0)).toBe(true)
    expect(sections.some(section => section.capacity !== null && section.available === 0 && (section.waitlisted ?? 0) > 0)).toBe(true)
    expect(sections.some(section => section.capacity === null && section.available === null)).toBe(true)
    expect(courses.some(course => course.unitsFrom < course.unitsTo && course.unitsInc > 0)).toBe(true)
    expect(sections.some((left, index) => sections.slice(index + 1).some(right => overlaps(left, right)))).toBe(true)
    expect(sections.some((left, index) => sections.slice(index + 1).some(right => examsOverlap(left, right)))).toBe(true)

    const serialized = JSON.stringify(readFixture())
    expect(serialized).not.toMatch(/description|credential|email|pid|student/i)
  })

  it('keeps same-family sibling meetings and exams exact after normalization', async () => {
    const source = new FixtureCatalogSource(readFixture())
    const { sections } = await normalizedSections(source)
    const a01 = sections.find(section => section.id === 'FA26:DEMO:101:A01')
    const a02 = sections.find(section => section.id === 'FA26:DEMO:101:A02')

    expect(a01).toMatchObject({ familyCode: 'A', instructor: 'Mira Vale' })
    expect(a02).toMatchObject({ familyCode: 'A', instructor: 'Orin Lark' })
    expect(a01?.meetings).toEqual([
      { type: 'DI', days: 'Tu', startMin: 600, endMin: 650, building: 'NOVA', room: '115' },
      { type: 'LE', days: 'MWF', startMin: 540, endMin: 590, building: 'NOVA', room: '101' }
    ])
    expect(a02?.meetings).toEqual([
      { type: 'DI', days: 'Th', startMin: 600, endMin: 650, building: 'NOVA', room: '116' },
      { type: 'LE', days: 'MWF', startMin: 540, endMin: 590, building: 'NOVA', room: '101' }
    ])
    const sharedFinal = [{
      type: 'FI', date: '2026-12-08', startMin: 540, endMin: 720, building: 'NOVA', room: '101'
    }]
    expect(a01?.exams).toEqual(sharedFinal)
    expect(a02?.exams).toEqual(sharedFinal)
  })

  it('uses only the approved invented instructors and no free-text catalog content', async () => {
    const source = new FixtureCatalogSource(readFixture())
    const [term] = await source.listTerms()
    const scraped = (
      await Promise.all(term.departments.map(department => source.fetchDepartment(term.id, department)))
    ).flat()
    const instructors = scraped.flatMap(({ sections }) => sections.flatMap(section =>
      section.registrationNumber === null ? [] : section.instructors
    )).sort()

    expect(instructors).toEqual(['Mira Vale', 'Nico Fern', 'Orin Lark', 'Sela Wynn', 'Tavi Bloom'])
    expect(scraped.every(({ course }) => !('description' in course) && course.note === undefined)).toBe(true)
    expect(scraped.flatMap(({ sections }) => sections).every(section => section.note === undefined)).toBe(true)
  })

  it('rejects unknown terms and departments', async () => {
    const source = new FixtureCatalogSource(readFixture())

    await expect(source.fetchDepartment('WI27', 'DEMO')).rejects.toThrow(/unknown term/i)
    await expect(source.fetchDepartment('FA26', 'NOPE')).rejects.toThrow(/unknown department/i)
  })

  it('rejects unknown fields and collection bounds', () => {
    const withUnknownField = { ...(readFixture() as object), unexpected: true }
    expect(() => new FixtureCatalogSource(withUnknownField)).toThrow(/unrecognized key/i)

    const noTerms = structuredClone(readFixture()) as { terms: unknown[] }
    noTerms.terms = []
    expect(() => new FixtureCatalogSource(noTerms)).toThrow()

    const noDepartments = structuredClone(readFixture()) as { terms: Array<{ departments: unknown[] }> }
    noDepartments.terms[0].departments = []
    expect(() => new FixtureCatalogSource(noDepartments)).toThrow()

    const noCourses = structuredClone(readFixture()) as {
      terms: Array<{ departments: Array<{ courses: unknown[] }> }>
    }
    noCourses.terms[0].departments[0].courses = []
    expect(() => new FixtureCatalogSource(noCourses)).toThrow()

    const noSections = structuredClone(readFixture()) as {
      terms: Array<{ departments: Array<{ courses: Array<{ families: Array<{ sections: unknown[] }> }> }> }>
    }
    noSections.terms[0].departments[0].courses[0].families[0].sections = []
    expect(() => new FixtureCatalogSource(noSections)).toThrow()

    const noMeetings = structuredClone(readFixture()) as {
      terms: Array<{ departments: Array<{ courses: Array<{ families: Array<{ sections: Array<{ meetings: unknown[] }> }> }> }> }>
    }
    noMeetings.terms[0].departments[0].courses[0].families[0].sections[0].meetings = []
    expect(() => new FixtureCatalogSource(noMeetings)).toThrow()

    const tooManyExams = structuredClone(readFixture()) as {
      terms: Array<{ departments: Array<{ courses: Array<{ families: Array<{ exams: unknown[] }> }> }> }>
    }
    const exam = tooManyExams.terms[0].departments[0].courses[0].families[0].exams[0]
    tooManyExams.terms[0].departments[0].courses[0].families[0].exams = Array(5).fill(exam)
    expect(() => new FixtureCatalogSource(tooManyExams)).toThrow()
  })

  it('rejects section codes whose derived family differs from the declared family', () => {
    const mismatchedFamily = structuredClone(readFixture()) as {
      terms: Array<{ departments: Array<{ courses: Array<{
        families: Array<{ sections: Array<{ sectionCode: string }> }>
      }> }> }>
    }
    mismatchedFamily.terms[0].departments[0].courses[0].families[0].sections[1].sectionCode = 'AB02'

    expect(() => new FixtureCatalogSource(mismatchedFamily)).toThrow(/family/i)
  })
})
