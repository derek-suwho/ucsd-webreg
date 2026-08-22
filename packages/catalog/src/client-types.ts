import type { CatalogProvenance } from './source.js'

export type CatalogSection = {
  id: string; courseId: string; code: string; family: string
  regNum: number | null; instructor: string | null; cap: number | null; avail: number | null
  wait: number | null; cancelled: boolean
  meetings: {
    type: string; days: string | null; start: number | null; end: number | null
    bldg: string | null; room: string | null
  }[]
  exams: { type: string; date: string; start: number; end: number }[]
}

export type CatalogCourse = {
  id: string; subject: string; number: string; title: string
  unitsFrom: number; unitsTo: number; unitsInc: number; sectionIds: string[]
}

export type CatalogData = {
  termId: string; version: number; generatedAt: string
  provenance: CatalogProvenance
  courses: Record<string, CatalogCourse>; sections: Record<string, CatalogSection>
}
