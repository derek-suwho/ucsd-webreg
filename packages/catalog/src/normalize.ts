import type { ParsedRow } from './types.js'

export type NormalizedMeeting = {
  type: string; days: string | null; startMin: number | null; endMin: number | null
  building: string | null; room: string | null
}
export type NormalizedExam = {
  type: 'FI' | 'MI'; date: string; startMin: number; endMin: number
  building: string | null; room: string | null
}
export type NormalizedSection = {
  id: string; sectionCode: string; familyCode: string; registrationNumber: number | null
  instructor: string | null; capacity: number | null; available: number | null
  waitlisted: number | null; isCancelled: boolean; note?: string
  meetings: NormalizedMeeting[]; exams: NormalizedExam[]
}
export type NormalizedCourse = {
  id: string; subject: string; number: string; title: string
  unitsFrom: number; unitsTo: number; unitsInc: number; restriction: string[]; note?: string
  sections: NormalizedSection[]
}

const VALID_MEETING_TYPES = new Set(['LE', 'DI', 'LA', 'SE', 'ST', 'IN', 'IT', 'FW', 'TU', 'PR', 'RE'])

type SectionRow = Extract<ParsedRow, { kind: 'section' }>

/** Leading letters of a section code (`A01` -> `A`); an all-numeric code is its own family (`001` -> `001`). */
export function familyOfSectionCode(sectionCode: string): string {
  const m = sectionCode.match(/^[A-Za-z]+/)
  return m ? m[0] : sectionCode
}

/** Weekly meeting from a non-exam row. Unknown types map to 'OT' with a warning. Cancelled rows carry none. */
function meetingsFromRow(row: SectionRow, courseKey: string, warnings: string[]): NormalizedMeeting[] {
  if (row.examDate !== null) return []
  let type = row.meetingType
  if (!VALID_MEETING_TYPES.has(type)) {
    warnings.push(`${courseKey}: unknown meeting type "${type}"`)
    type = 'OT'
  }
  return [{ type, days: row.days, startMin: row.startMin, endMin: row.endMin, building: row.building, room: row.room }]
}

function examFromRow(row: SectionRow): NormalizedExam {
  return {
    type: row.meetingType as 'FI' | 'MI',
    date: row.examDate!,
    startMin: row.startMin ?? 0,
    endMin: row.endMin ?? 0,
    building: row.building,
    room: row.room
  }
}

/** Groups a course's accumulated section rows by family and resolves shared meetings/exams onto each enrollable section. */
function resolveFamilies(
  course: NormalizedCourse, rows: { row: SectionRow; family: string | null }[],
  courseKey: string, termId: string, warnings: string[]
): void {
  const families = new Map<string, SectionRow[]>()
  for (const { row, family } of rows) {
    if (family === null) continue // exam with no preceding family in this course; nothing to attach to
    if (!families.has(family)) families.set(family, [])
    families.get(family)!.push(row)
  }

  for (const [familyCode, familyRows] of families) {
    const enrollable = familyRows.filter(r => r.registrationNumber !== null && r.sectionCode !== null)
    const sharedMeetingRows = familyRows.filter(r => r.registrationNumber === null && r.sectionCode !== null)
    const examRows = familyRows.filter(r => r.examDate !== null && !r.cancelled)

    const sharedMeetings = sharedMeetingRows.flatMap(r => meetingsFromRow(r, courseKey, warnings))
    const sharedExams = examRows.map(examFromRow)

    for (const row of enrollable) {
      course.sections.push({
        id: `${termId}:${course.subject}:${course.number}:${row.sectionCode}`,
        sectionCode: row.sectionCode!,
        familyCode,
        registrationNumber: row.registrationNumber,
        instructor: row.instructors[0] ?? null,
        capacity: row.capacity,
        available: row.available,
        waitlisted: row.waitlisted,
        isCancelled: row.cancelled,
        note: row.note,
        // Exams/shared meetings attach to every enrollable section of the family, cancelled or not (spec-literal);
        // presentation layer decides what to show. Assumes exam rows follow their own family's section rows in
        // document order (parse.ts emission order).
        meetings: [...meetingsFromRow(row, courseKey, warnings), ...sharedMeetings],
        exams: [...sharedExams]
      })
    }
  }
}

export function normalizeDepartment(
  rows: ParsedRow[], termId: string
): { courses: NormalizedCourse[]; warnings: string[] } {
  const courses: NormalizedCourse[] = []
  const warnings: string[] = []

  let course: NormalizedCourse | null = null
  let courseKey = ''
  let pending: { row: SectionRow; family: string | null }[] = []
  let currentFamily: string | null = null

  const flush = (): void => {
    if (course) resolveFamilies(course, pending, courseKey, termId, warnings)
    pending = []
    currentFamily = null
  }

  for (const row of rows) {
    if (row.kind === 'course') {
      flush()
      course = {
        id: `${termId}:${row.subject}:${row.number}`,
        subject: row.subject, number: row.number, title: row.title,
        unitsFrom: row.units.from, unitsTo: row.units.to, unitsInc: row.units.inc,
        restriction: row.restriction, note: row.note, sections: []
      }
      courseKey = `${row.subject} ${row.number}`
      courses.push(course)
      continue
    }
    if (row.sectionCode !== null) currentFamily = familyOfSectionCode(row.sectionCode)
    pending.push({ row, family: currentFamily })
  }
  flush()

  return { courses, warnings }
}
