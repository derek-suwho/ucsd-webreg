import { parseResultPage } from '@webreg/catalog'
import type { SocFetcher } from './fetcher.js'

export const MAX_PAGES = 100
export const MAX_ROWS_PER_DEPARTMENT = 10_000
export const PAGE_WORKER_CONCURRENCY = 4

/** Only the fetcher surface crawling needs — lets tests pass a plain stub instead of a real SocFetcher. */
export type SyncFetcher = Pick<SocFetcher, 'fetchDepartmentList' | 'fetchResultPage'>

/** Fetches and parses one department with bounded pages, rows, and page-task concurrency. */
export async function fetchDepartmentRows(
  fetcher: SyncFetcher,
  termId: string,
  dept: string
): Promise<ReturnType<typeof parseResultPage>['rows']> {
  const firstHtml = await fetcher.fetchResultPage(termId, [dept], 1)
  const first = parseResultPage(firstHtml)

  if (!Number.isSafeInteger(first.pageCount) || first.pageCount < 1 || first.pageCount > MAX_PAGES) {
    throw new Error('Invalid upstream page count')
  }
  if (first.rows.length > MAX_ROWS_PER_DEPARTMENT) {
    throw new Error('Upstream row limit exceeded')
  }

  const rowsByPage: Array<typeof first.rows | undefined> = Array(first.pageCount)
  rowsByPage[0] = first.rows
  let nextPage = 2
  let rowCount = first.rows.length
  let failed = false

  const worker = async (): Promise<void> => {
    try {
      while (!failed) {
        const page = nextPage++
        if (page > first.pageCount) return

        const html = await fetcher.fetchResultPage(termId, [dept], page)
        if (failed) return
        const parsed = parseResultPage(html)
        if (rowCount + parsed.rows.length > MAX_ROWS_PER_DEPARTMENT) {
          throw new Error('Upstream row limit exceeded')
        }
        rowCount += parsed.rows.length
        rowsByPage[page - 1] = parsed.rows
      }
    } catch (error) {
      failed = true
      throw error
    }
  }

  const workerCount = Math.min(PAGE_WORKER_CONCURRENCY, first.pageCount - 1)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  return rowsByPage.flatMap(rows => rows ?? [])
}
