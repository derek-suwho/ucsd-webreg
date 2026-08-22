import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fetchDepartmentRows } from './crawl.js'

const fixture = readFileSync(
  new URL('../../../packages/catalog/fixtures/dept-basic.html', import.meta.url),
  'utf8'
)

const pageHtml = (pageCount: number, page: number): string =>
  fixture
    .replace('(1 of 1)', `(1 of ${pageCount})`)
    .replace('059266', String(page * 100_000 + 1))
    .replace('059267', String(page * 100_000 + 2))

describe('fetchDepartmentRows', () => {
  it.each([0, 101])('rejects an upstream page count of %i before scheduling pages', async pageCount => {
    let calls = 0
    const fetcher = {
      fetchDepartmentList: async () => ['SOC'],
      fetchResultPage: async (_termId: string, _depts: string[], page: number) => {
        calls++
        return pageHtml(pageCount, page)
      }
    }

    await expect(fetchDepartmentRows(fetcher, 'FA26', 'SOC')).rejects.toThrow(
      'Invalid upstream page count'
    )
    expect(calls).toBe(1)
  })

  it('rejects cumulative rows above 10,000 when each page is individually within the cap', async () => {
    const sectionRow = fixture.match(/<tr class="sectxt">[\s\S]*?<\/tr>/)?.[0]
    expect(sectionRow).toBeDefined()
    const pageWithinLimit = (page: number) =>
      pageHtml(2, page).replace(sectionRow!, sectionRow!.repeat(5_000))
    const fetcher = {
      fetchDepartmentList: async () => ['SOC'],
      fetchResultPage: async (_termId: string, _depts: string[], page: number) =>
        pageWithinLimit(page)
    }

    await expect(fetchDepartmentRows(fetcher, 'FA26', 'SOC')).rejects.toThrow(
      'Upstream row limit exceeded'
    )
  })

  it('preserves page order when later pages finish first', async () => {
    const fetcher = {
      fetchDepartmentList: async () => ['SOC'],
      fetchResultPage: async (_termId: string, _depts: string[], page: number) => {
        await new Promise(resolve => setTimeout(resolve, (5 - page) * 5))
        return pageHtml(4, page)
      }
    }

    const rows = await fetchDepartmentRows(fetcher, 'FA26', 'SOC')
    const registrationNumbers = rows.flatMap(row =>
      row.kind === 'section' && row.registrationNumber != null ? [row.registrationNumber] : []
    )

    expect(registrationNumbers).toEqual([
      100_001,
      100_002,
      200_001,
      200_002,
      300_001,
      300_002,
      400_001,
      400_002
    ])
  })

  it('runs at most four page fetch tasks concurrently', async () => {
    let active = 0
    let maxActive = 0
    const fetcher = {
      fetchDepartmentList: async () => ['SOC'],
      fetchResultPage: async (_termId: string, _depts: string[], page: number) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise(resolve => setTimeout(resolve, 5))
        active--
        return pageHtml(9, page)
      }
    }

    await fetchDepartmentRows(fetcher, 'FA26', 'SOC')

    expect(maxActive).toBeLessThanOrEqual(4)
  })
})
