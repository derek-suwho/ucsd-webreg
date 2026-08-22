import type { CatalogSource, ScrapedCourse, SourceTerm } from '@webreg/catalog'

export const TSS_SOURCE_DISABLED = 'TSS source disabled'

export class TssSource implements CatalogSource {
  readonly kind = 'tss' as const
  readonly knownTermIds = Object.freeze([]) as readonly string[]

  async listTerms(): Promise<SourceTerm[]> {
    throw new Error(TSS_SOURCE_DISABLED)
  }

  async fetchDepartment(_termId: string, _department: string): Promise<ScrapedCourse[]> {
    throw new Error(TSS_SOURCE_DISABLED)
  }
}
