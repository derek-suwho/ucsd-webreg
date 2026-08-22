import { z } from 'zod'
import type { ParsedRow } from './types.js'

const MAX_DEPARTMENTS = 256

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'invalid ISO date')

export const catalogSourceKindSchema = z.enum(['fixture', 'legacy-soc', 'tss'])
export const sourceTermIdSchema = z.string().trim().min(1).max(16)

export const catalogProvenanceSchema = z.object({
  sourceKind: catalogSourceKindSchema,
  mode: z.enum(['demo', 'live']),
  sourceGeneratedAt: z.string().datetime({ offset: true })
}).superRefine((provenance, ctx) => {
  if (provenance.sourceKind === 'fixture' && provenance.mode === 'live') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mode'],
      message: 'fixture provenance must use demo mode'
    })
  }
})

export type CatalogProvenance = z.infer<typeof catalogProvenanceSchema>

export const sourceTermSchema = z.object({
  id: sourceTermIdSchema,
  name: z.string().trim().min(1).max(256),
  startsAt: isoDateSchema,
  endsAt: isoDateSchema,
  departments: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_DEPARTMENTS),
  sourceGeneratedAt: z.string().datetime({ offset: true })
}).superRefine((term, ctx) => {
  if (term.startsAt > term.endsAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endsAt'],
      message: 'endsAt must not be before startsAt'
    })
  }
  if (new Set(term.departments).size !== term.departments.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['departments'],
      message: 'departments must be unique'
    })
  }
})

export type SourceTerm = z.infer<typeof sourceTermSchema>

type CourseRow = Extract<ParsedRow, { kind: 'course' }>
type SectionRow = Extract<ParsedRow, { kind: 'section' }>

export type ScrapedCourse = { course: CourseRow; sections: SectionRow[] }

export interface CatalogSource {
  readonly kind: 'fixture' | 'legacy-soc' | 'tss'
  /** Validated term IDs this source owns even when live term discovery fails. */
  readonly knownTermIds: readonly string[]
  listTerms(): Promise<SourceTerm[]>
  fetchDepartment(termId: string, department: string): Promise<ScrapedCourse[]>
}

export function flattenScrapedCourses(courses: ScrapedCourse[]): ParsedRow[] {
  return courses.flatMap(({ course, sections }) => [course, ...sections])
}
