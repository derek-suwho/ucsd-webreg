import { describe, it, expect } from 'vitest'
import { normalizeDepartment } from './normalize'
import type { ParsedRow } from './types'

const courseRow: ParsedRow = {
  kind: 'course',
  subject: 'CSE',
  number: '110',
  title: 'Software Engineering',
  units: { from: 4, to: 4, inc: 1 },
  restriction: []
}

type SectionRow = Extract<ParsedRow, { kind: 'section' }>
function sectionRow(overrides: Partial<SectionRow>): ParsedRow {
  return {
    kind: 'section',
    registrationNumber: null,
    meetingType: 'LE',
    sectionCode: 'A00',
    examDate: null,
    days: 'MWF',
    startMin: 600,
    endMin: 650,
    building: 'CENTR',
    room: '109',
    instructors: ['Jane Doe'],
    available: 10,
    capacity: 30,
    waitlisted: null,
    cancelled: false,
    ...overrides
  }
}

describe('normalizeDepartment: shared-lecture family', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({ registrationNumber: null, meetingType: 'LE', sectionCode: 'A00' }),
    sectionRow({
      registrationNumber: 59266, meetingType: 'DI', sectionCode: 'A01',
      days: 'Tu', startMin: 780, endMin: 830
    }),
    sectionRow({
      registrationNumber: 59267, meetingType: 'DI', sectionCode: 'A02',
      days: 'Th', startMin: 780, endMin: 830
    }),
    sectionRow({
      registrationNumber: null, meetingType: 'FI', sectionCode: null, examDate: '2026-12-07',
      days: null, startMin: 1020, endMin: 1140, building: null, room: null, instructors: []
    })
  ]
  const { courses, warnings } = normalizeDepartment(rows, 'FA26')

  it('produces exactly the 2 enrollable discussion sections, not the parent lecture', () => {
    expect(courses).toHaveLength(1)
    expect(courses[0].id).toBe('FA26:CSE:110')
    expect(courses[0].sections).toHaveLength(2)
  })
  it('each discussion carries its own meeting + the shared lecture meeting + the exam', () => {
    const a01 = courses[0].sections.find(s => s.sectionCode === 'A01')!
    expect(a01.id).toBe('FA26:CSE:110:A01')
    expect(a01.meetings).toHaveLength(2) // own DI + shared LE
    expect(a01.exams).toHaveLength(1)
    expect(a01.familyCode).toBe('A')
    expect(a01.exams[0]).toMatchObject({ type: 'FI', date: '2026-12-07', startMin: 1020, endMin: 1140 })

    const a02 = courses[0].sections.find(s => s.sectionCode === 'A02')!
    expect(a02.meetings).toHaveLength(2)
    expect(a02.exams).toHaveLength(1)
  })
  it('no warnings for valid meeting types', () => {
    expect(warnings).toHaveLength(0)
  })
})

describe('normalizeDepartment: standalone A00 with its own reg number', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({ registrationNumber: 12345, meetingType: 'LE', sectionCode: 'A00' })
  ]
  const { courses } = normalizeDepartment(rows, 'FA26')

  it('the lecture itself becomes the single enrollable section', () => {
    expect(courses[0].sections).toHaveLength(1)
    const a00 = courses[0].sections[0]
    expect(a00.sectionCode).toBe('A00')
    expect(a00.registrationNumber).toBe(12345)
    expect(a00.meetings).toHaveLength(1)
  })
})

describe('normalizeDepartment: unknown meeting type', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({ registrationNumber: 55555, meetingType: 'ZZ', sectionCode: 'A00' })
  ]
  const { courses, warnings } = normalizeDepartment(rows, 'FA26')

  it('maps to OT and records one warning naming the course and raw type', () => {
    expect(courses[0].sections[0].meetings[0].type).toBe('OT')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('CSE 110')
    expect(warnings[0]).toContain('ZZ')
  })
})

describe('normalizeDepartment: cancelled section', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({
      registrationNumber: 99999, meetingType: 'LE', sectionCode: 'A00', cancelled: true,
      days: null, startMin: null, endMin: null, building: null, room: null
    })
  ]
  const { courses } = normalizeDepartment(rows, 'FA26')

  it('is kept with isCancelled true', () => {
    expect(courses[0].sections).toHaveLength(1)
    expect(courses[0].sections[0].isCancelled).toBe(true)
  })
})

describe('normalizeDepartment: numeric-only section code family', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({ registrationNumber: 11111, meetingType: 'SE', sectionCode: '001' })
  ]
  const { courses } = normalizeDepartment(rows, 'FA26')

  it('familyCode is the whole numeric code', () => {
    expect(courses[0].sections[0].familyCode).toBe('001')
  })
})

describe('normalizeDepartment: multi-family course, each family keeps its own meeting + exam', () => {
  const rows: ParsedRow[] = [
    courseRow,
    // Family A: shared lecture, one discussion, then A's exam
    sectionRow({ registrationNumber: null, meetingType: 'LE', sectionCode: 'A00' }),
    sectionRow({
      registrationNumber: 61111, meetingType: 'DI', sectionCode: 'A01',
      days: 'Tu', startMin: 780, endMin: 830
    }),
    sectionRow({
      registrationNumber: null, meetingType: 'FI', sectionCode: null, examDate: '2026-12-07',
      days: null, startMin: 1020, endMin: 1140, building: null, room: null, instructors: []
    }),
    // Family B: shared lecture, one discussion, then B's exam
    sectionRow({ registrationNumber: null, meetingType: 'LE', sectionCode: 'B00' }),
    sectionRow({
      registrationNumber: 62222, meetingType: 'DI', sectionCode: 'B01',
      days: 'Th', startMin: 900, endMin: 950
    }),
    sectionRow({
      registrationNumber: null, meetingType: 'FI', sectionCode: null, examDate: '2026-12-08',
      days: null, startMin: 1200, endMin: 1320, building: null, room: null, instructors: []
    })
  ]
  const { courses } = normalizeDepartment(rows, 'FA26')

  it('each discussion gets exactly its own family meeting + exam, no cross-leak', () => {
    expect(courses[0].sections).toHaveLength(2)

    const a01 = courses[0].sections.find(s => s.sectionCode === 'A01')!
    expect(a01.meetings).toHaveLength(2) // own DI + family A's shared LE
    expect(a01.exams).toHaveLength(1)
    expect(a01.exams[0]).toMatchObject({ date: '2026-12-07', startMin: 1020, endMin: 1140 })

    const b01 = courses[0].sections.find(s => s.sectionCode === 'B01')!
    expect(b01.meetings).toHaveLength(2) // own DI + family B's shared LE
    expect(b01.exams).toHaveLength(1)
    expect(b01.exams[0]).toMatchObject({ date: '2026-12-08', startMin: 1200, endMin: 1320 })
  })
})

describe('normalizeDepartment: cancelled enrollable section in a family with an exam', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({ registrationNumber: null, meetingType: 'LE', sectionCode: 'A00' }),
    sectionRow({
      registrationNumber: 63333, meetingType: 'DI', sectionCode: 'A01', cancelled: true,
      days: 'Tu', startMin: 780, endMin: 830
    }),
    sectionRow({
      registrationNumber: null, meetingType: 'FI', sectionCode: null, examDate: '2026-12-07',
      days: null, startMin: 1020, endMin: 1140, building: null, room: null, instructors: []
    })
  ]
  const { courses } = normalizeDepartment(rows, 'FA26')

  it('cancelled section keeps own meeting + shared meeting, plus family exam', () => {
    const a01 = courses[0].sections.find(s => s.sectionCode === 'A01')!
    expect(a01.isCancelled).toBe(true)
    expect(a01.meetings).toHaveLength(2) // own DI + shared LE
    expect(a01.meetings[0]).toMatchObject({ type: 'DI', days: 'Tu', startMin: 780, endMin: 830 })
    expect(a01.meetings[1]).toMatchObject({ type: 'LE', days: 'MWF', startMin: 600, endMin: 650 })
    expect(a01.exams).toHaveLength(1)
    expect(a01.exams[0]).toMatchObject({ date: '2026-12-07' })
  })
})

describe('normalizeDepartment: exam row with no enrollable sections in its family', () => {
  const rows: ParsedRow[] = [
    courseRow,
    sectionRow({ registrationNumber: null, meetingType: 'LE', sectionCode: 'A00' }),
    sectionRow({
      registrationNumber: null, meetingType: 'FI', sectionCode: null, examDate: '2026-12-07',
      days: null, startMin: 1020, endMin: 1140, building: null, room: null, instructors: []
    })
  ]

  it('does not throw and produces no sections', () => {
    const { courses } = normalizeDepartment(rows, 'FA26')
    expect(courses[0].sections).toHaveLength(0)
  })
})
