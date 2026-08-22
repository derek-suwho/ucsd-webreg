import { z } from 'zod'
import { familyOfSectionCode } from './normalize.js'
import { sourceTermSchema, type CatalogSource, type ScrapedCourse, type SourceTerm } from './source.js'
import type { ParsedRow } from './types.js'

const MAX_TERMS = 16
const MAX_DEPARTMENTS = 256
const MAX_COURSES = 2_000
const MAX_SECTIONS = 128
const MAX_MEETINGS = 16
const MAX_EXAMS = 4

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'invalid ISO date')

const nullableLabelSchema = z.string().trim().min(1).max(64).nullable()
const minuteSchema = z.number().int().min(0).max(1_440)

const meetingFields = {
  type: z.enum(['LE', 'DI', 'LA', 'SE', 'ST', 'IN', 'IT', 'FW', 'TU', 'PR', 'RE']),
  days: z.string().trim().min(1).max(16).nullable(),
  startMin: minuteSchema.nullable(),
  endMin: minuteSchema.nullable(),
  building: nullableLabelSchema,
  room: nullableLabelSchema
} as const

function validateMeeting(
  meeting: { days: string | null; startMin: number | null; endMin: number | null },
  ctx: z.RefinementCtx
): void {
  const scheduled = [meeting.days, meeting.startMin, meeting.endMin].every(value => value !== null)
  const tba = [meeting.days, meeting.startMin, meeting.endMin].every(value => value === null)
  if (!scheduled && !tba) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'days and times must all be scheduled or TBA' })
  }
  if (meeting.startMin !== null && meeting.endMin !== null && meeting.startMin >= meeting.endMin) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endMin'], message: 'endMin must be after startMin' })
  }
}

const meetingSchema = z.object(meetingFields).strict().superRefine(validateMeeting)
const sharedMeetingSchema = z.object({
  sectionCode: z.string().trim().min(1).max(16),
  ...meetingFields
}).strict().superRefine(validateMeeting)

const examSchema = z.object({
  type: z.enum(['FI', 'MI']),
  date: dateSchema,
  startMin: minuteSchema,
  endMin: minuteSchema,
  building: nullableLabelSchema,
  room: nullableLabelSchema
}).strict().refine(exam => exam.startMin < exam.endMin, {
  path: ['endMin'],
  message: 'endMin must be after startMin'
})

const sectionSchema = z.object({
  registrationNumber: z.number().int().min(100_000).max(999_999),
  sectionCode: z.string().trim().min(1).max(16),
  instructors: z.array(z.string().trim().min(1).max(128)).max(8),
  available: z.number().int().min(0).max(10_000).nullable(),
  capacity: z.number().int().min(0).max(10_000).nullable(),
  waitlisted: z.number().int().min(0).max(10_000).nullable(),
  cancelled: z.boolean(),
  note: z.string().trim().min(1).max(1_000).optional(),
  meetings: z.tuple([meetingSchema])
}).strict().superRefine((section, ctx) => {
  if ((section.capacity === null) !== (section.available === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['available'],
      message: 'unlimited sections require null capacity and available'
    })
  }
  if (section.capacity !== null && section.available !== null && section.available > section.capacity) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['available'], message: 'available exceeds capacity' })
  }
  if ((section.waitlisted ?? 0) > 0 && section.available !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['waitlisted'], message: 'waitlist requires full section' })
  }
})

const familySchema = z.object({
  code: z.string().trim().min(1).max(16),
  sharedMeetings: z.array(sharedMeetingSchema).max(MAX_MEETINGS),
  sections: z.array(sectionSchema).min(1).max(MAX_SECTIONS),
  exams: z.array(examSchema).max(MAX_EXAMS)
}).strict().superRefine((family, ctx) => {
  const sectionCodes = [
    ...family.sharedMeetings.map(meeting => meeting.sectionCode),
    ...family.sections.map(section => section.sectionCode)
  ]
  if (new Set(sectionCodes).size !== sectionCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sections'], message: 'family section codes must be unique' })
  }
  if (sectionCodes.some(code => familyOfSectionCode(code) !== family.code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['code'], message: 'section code must match its family' })
  }
})

const courseSchema = z.object({
  subject: z.string().trim().regex(/^[A-Z][A-Z0-9]{1,7}$/),
  number: z.string().trim().min(1).max(16),
  title: z.string().trim().min(1).max(256),
  units: z.object({
    from: z.number().min(0).max(99),
    to: z.number().min(0).max(99),
    inc: z.number().min(0).max(99)
  }).strict().superRefine((units, ctx) => {
    if (units.from > units.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'unit range is reversed' })
    }
    if (units.from < units.to && units.inc === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inc'], message: 'variable units require an increment' })
    }
  }),
  restriction: z.array(z.string().trim().min(1).max(32)).max(32),
  note: z.string().trim().min(1).max(1_000).optional(),
  families: z.array(familySchema).min(1).max(MAX_SECTIONS)
}).strict().superRefine((course, ctx) => {
  const selectableCount = course.families.reduce((count, family) => count + family.sections.length, 0)
  if (selectableCount > MAX_SECTIONS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['families'], message: 'too many selectable sections' })
  }
  const familyCodes = course.families.map(family => family.code)
  if (new Set(familyCodes).size !== familyCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['families'], message: 'families must be unique' })
  }
})

const departmentSchema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9]{1,7}$/),
  courses: z.array(courseSchema).min(1).max(MAX_COURSES)
}).strict().superRefine((department, ctx) => {
  const ids = department.courses.map(course => `${course.subject}:${course.number}`)
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['courses'], message: 'courses must be unique' })
  }
})

const fixtureTermSchema = z.object({
  id: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(256),
  startsAt: dateSchema,
  endsAt: dateSchema,
  departments: z.array(departmentSchema).min(1).max(MAX_DEPARTMENTS)
}).strict().superRefine((term, ctx) => {
  if (term.startsAt > term.endsAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'term date range is reversed' })
  }
  const codes = term.departments.map(department => department.code)
  if (new Set(codes).size !== codes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['departments'], message: 'departments must be unique' })
  }
})

const fixtureSchema = z.object({
  sourceGeneratedAt: z.string().datetime({ offset: true }),
  terms: z.array(fixtureTermSchema).min(1).max(MAX_TERMS)
}).strict().superRefine((fixture, ctx) => {
  const ids = fixture.terms.map(term => term.id)
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['terms'], message: 'terms must be unique' })
  }
})

type Fixture = z.infer<typeof fixtureSchema>
type FixtureFamily = Fixture['terms'][number]['departments'][number]['courses'][number]['families'][number]
type FixtureSection = FixtureFamily['sections'][number]
type FixtureMeeting = FixtureSection['meetings'][number]

function meetingRow(
  meeting: FixtureMeeting,
  sectionCode: string,
  section?: FixtureSection
): Extract<ParsedRow, { kind: 'section' }> {
  return {
    kind: 'section',
    registrationNumber: section?.registrationNumber ?? null,
    meetingType: meeting.type,
    sectionCode,
    examDate: null,
    days: meeting.days,
    startMin: meeting.startMin,
    endMin: meeting.endMin,
    building: meeting.building,
    room: meeting.room,
    instructors: section ? [...section.instructors] : [],
    available: section?.available ?? null,
    capacity: section?.capacity ?? null,
    waitlisted: section?.waitlisted ?? null,
    cancelled: section?.cancelled ?? false,
    note: section?.note
  }
}

function familyRows(family: FixtureFamily): Extract<ParsedRow, { kind: 'section' }>[] {
  return [
    ...family.sharedMeetings.map(meeting => meetingRow(meeting, meeting.sectionCode)),
    ...family.sections.map(section => meetingRow(section.meetings[0], section.sectionCode, section)),
    ...family.exams.map(exam => ({
      kind: 'section' as const,
      registrationNumber: null,
      meetingType: exam.type,
      sectionCode: null,
      examDate: exam.date,
      days: null,
      startMin: exam.startMin,
      endMin: exam.endMin,
      building: exam.building,
      room: exam.room,
      instructors: [],
      available: null,
      capacity: null,
      waitlisted: null,
      cancelled: false
    }))
  ]
}

export class FixtureCatalogSource implements CatalogSource {
  readonly kind = 'fixture' as const
  readonly knownTermIds: readonly string[]
  private readonly fixture: Fixture

  constructor(input: unknown) {
    this.fixture = fixtureSchema.parse(input)
    this.knownTermIds = Object.freeze(this.fixture.terms.map(term => term.id))
  }

  async listTerms(): Promise<SourceTerm[]> {
    return this.fixture.terms.map(term => sourceTermSchema.parse({
      id: term.id,
      name: term.name,
      startsAt: term.startsAt,
      endsAt: term.endsAt,
      departments: term.departments.map(department => department.code),
      sourceGeneratedAt: this.fixture.sourceGeneratedAt
    }))
  }

  async fetchDepartment(termId: string, department: string): Promise<ScrapedCourse[]> {
    const term = this.fixture.terms.find(candidate => candidate.id === termId)
    if (!term) throw new Error(`Unknown term: ${termId}`)
    const fixtureDepartment = term.departments.find(candidate => candidate.code === department)
    if (!fixtureDepartment) throw new Error(`Unknown department: ${department}`)

    return fixtureDepartment.courses.map(course => ({
      course: {
        kind: 'course',
        subject: course.subject,
        number: course.number,
        title: course.title,
        units: { ...course.units },
        restriction: [...course.restriction],
        note: course.note
      },
      sections: course.families.flatMap(familyRows)
    }))
  }
}
