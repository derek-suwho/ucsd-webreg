import {
  sourceTermSchema,
  type CatalogSource,
  type ParsedRow,
  type ScrapedCourse,
  type SnapshotLimits,
  type SourceTerm
} from '@webreg/catalog'
import { fetchDepartmentRows } from '../crawl.js'
import type { SocFetcher } from '../fetcher.js'
import { SeatRefreshError, seatRefresh } from '../seat-refresh.js'
import { withCatalogLock } from '../catalog-lock.js'

export type LegacyTerm = Omit<SourceTerm, 'departments' | 'sourceGeneratedAt'>

/** Last public Schedule of Classes term supported before the Fall 2026 TSS cutover. */
export const LEGACY_SOC_TERM_ALLOWLIST: readonly LegacyTerm[] = Object.freeze([Object.freeze({
  id: 'SP26',
  name: 'Spring Quarter 2026',
  startsAt: '2026-03-25',
  endsAt: '2026-06-05'
})])

function isBeforeFa26(termId: string): boolean {
  const match = /^(WI|SP|S1|S2|S3|FA)(\d{2})$/.exec(termId)
  if (!match) return false
  const year = Number(match[2])
  if (year !== 26) return year < 26
  return match[1] !== 'FA'
}

function groupRows(rows: ParsedRow[]): ScrapedCourse[] {
  const courses: ScrapedCourse[] = []
  for (const row of rows) {
    if (row.kind === 'course') {
      courses.push({ course: row, sections: [] })
    } else {
      const current = courses.at(-1)
      if (!current) throw new Error('Legacy SoC returned a section before its course')
      current.sections.push(row)
    }
  }
  return courses
}

export class LegacySocSource implements CatalogSource {
  readonly kind = 'legacy-soc' as const
  readonly knownTermIds: readonly string[]
  private readonly terms: readonly LegacyTerm[]
  private bootstrapPromise: Promise<void> | undefined

  constructor(
    private readonly fetcher: SocFetcher,
    terms: readonly LegacyTerm[] = LEGACY_SOC_TERM_ALLOWLIST
  ) {
    if (terms.length === 0) throw new Error('Legacy SoC allowlist must not be empty')
    const ids = new Set<string>()
    for (const term of terms) {
      if (!isBeforeFa26(term.id)) throw new Error(`Legacy SoC term must be before FA26: ${term.id}`)
      if (ids.has(term.id)) throw new Error(`Duplicate legacy SoC term: ${term.id}`)
      ids.add(term.id)
      sourceTermSchema.parse({
        ...term,
        departments: ['VALIDATION'],
        sourceGeneratedAt: '2026-01-01T00:00:00.000Z'
      })
    }
    this.terms = terms.map(term => Object.freeze({ ...term }))
    this.knownTermIds = Object.freeze(this.terms.map(term => term.id))
  }

  async listTerms(): Promise<SourceTerm[]> {
    await this.bootstrap()
    const sourceGeneratedAt = new Date().toISOString()
    return Promise.all(this.terms.map(async term => sourceTermSchema.parse({
      ...term,
      departments: await this.fetcher.fetchDepartmentList(term.id),
      sourceGeneratedAt
    })))
  }

  async fetchDepartment(termId: string, department: string): Promise<ScrapedCourse[]> {
    this.requireAllowedTerm(termId)
    await this.bootstrap()
    return groupRows(await fetchDepartmentRows(this.fetcher, termId, department))
  }

  /** Legacy-only fast seat path; full catalog orchestration remains CatalogSource-neutral. */
  async refreshSeats(
    dependencies: {
      operation?: typeof seatRefresh
      withLock?: typeof withCatalogLock
      snapshotLimits?: Partial<SnapshotLimits>
    } = {}
  ): Promise<void> {
    await this.bootstrap()
    for (const term of this.terms) {
      const locked = await (dependencies.withLock ?? withCatalogLock)(term.id, () =>
        (dependencies.operation ?? seatRefresh)(this.fetcher, term.id, {
          snapshotLimits: dependencies.snapshotLimits
        }))
      if (!locked.acquired) throw new SeatRefreshError('catalog_lock_skipped')
    }
  }

  private requireAllowedTerm(termId: string): void {
    if (!this.terms.some(term => term.id === termId)) {
      throw new Error(`Legacy SoC term not allowed: ${termId}`)
    }
  }

  private async bootstrap(): Promise<void> {
    this.bootstrapPromise ??= this.fetcher.bootstrap()
    await this.bootstrapPromise
  }
}
