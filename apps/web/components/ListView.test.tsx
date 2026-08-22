// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import { PLANNER_CATALOG } from './__tests__/planner-catalog'
import ListView from './ListView'

describe('ListView accessible data grid', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({
      termId: 'FA26',
      catalog: PLANNER_CATALOG,
      schedules: [{ id: 's1', termId: 'FA26', name: 'Primary', sectionIds: ['A1'] }],
      activeScheduleId: 's1',
      authed: false
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('bounds its focusable scroll area so the identity/header band can stay sticky', async () => {
    await act(async () => root.render(<ListView />))

    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Planned classes table"]')!
    expect(region.tabIndex).toBe(0)
    expect(region.className).toContain('overflow-auto')
    expect(region.className).toContain('max-h-[min(70vh,44rem)]')
    expect(region.className).toContain('print:max-h-none')
    expect(region.className).toContain('print:overflow-visible')
    const hint = document.getElementById(region.getAttribute('aria-describedby')!)!
    expect(hint.textContent).toContain('Scroll horizontally')
    expect(hint.className).not.toContain('sr-only')

    const headers = [...region.querySelectorAll<HTMLElement>('thead th')]
    expect(headers.every(header => header.className.includes('sticky') && header.className.includes('top-0'))).toBe(true)
    expect(headers.slice(0, 3).map(header => header.dataset.stickyIdentity)).toEqual(['course', 'title', 'section'])
    expect(headers.slice(0, 3).map(header => header.className)).toEqual(expect.arrayContaining([
      expect.stringContaining('left-0'),
      expect.stringContaining('left-32'),
      expect.stringContaining('left-80')
    ]))
    expect(region.querySelectorAll('tbody [data-sticky-identity]').length).toBeGreaterThanOrEqual(3)
  })

  it('renders only catalog-backed columns and keeps empty/stale row spans aligned', async () => {
    await act(async () => root.render(<ListView />))

    const headers = [...container.querySelectorAll('thead th')].map(header =>
      header.textContent?.replace(/\s+/g, ' ').trim()
    )
    expect(headers).toEqual([
      'Subject Course',
      'Title',
      'Section Code',
      'Type',
      'Instructor',
      'Units',
      'Days',
      'Time',
      'BLDG',
      'Room',
      'Status/ (Position)',
      'Action'
    ])
    expect(container.querySelector('tbody tr')?.children).toHaveLength(12)
    expect(container.textContent).not.toContain('Grade Option')

    await act(async () => {
      plannerStore.setState({
        schedules: [{ id: 's1', termId: 'FA26', name: 'Primary', sectionIds: [] }]
      })
    })
    expect(container.querySelector<HTMLTableCellElement>('tbody td')?.colSpan).toBe(12)

    await act(async () => {
      plannerStore.setState({
        schedules: [{ id: 's1', termId: 'FA26', name: 'Primary', sectionIds: ['missing'] }]
      })
    })
    const staleCells = container.querySelectorAll<HTMLTableCellElement>('tbody td')
    expect(staleCells).toHaveLength(2)
    expect(staleCells[0].colSpan).toBe(11)
  })

  it('marks only action cells as print-hidden and keeps the empty-state row printable', async () => {
    await act(async () => root.render(<ListView />))

    expect(container.querySelectorAll('[data-print-action]')).toHaveLength(2)
    expect(container.querySelector('th[data-print-action]')?.textContent).toContain('Action')

    await act(async () => {
      plannerStore.setState({
        schedules: [{ id: 's1', termId: 'FA26', name: 'Primary', sectionIds: [] }]
      })
    })
    const emptyCell = container.querySelector<HTMLTableCellElement>('tbody td')!
    expect(emptyCell.textContent).toContain('No classes on your schedule')
    expect(emptyCell.hasAttribute('data-print-action')).toBe(false)

    const printCss = readFileSync('apps/web/app/globals.css', 'utf8')
    expect(printCss).toContain('.planner-list-panel [data-print-action]')
    expect(printCss).not.toMatch(/\.planner-list-panel (?:th|td):last-child/)
  })

  it('gives dense-grid removal a 44px target and preserves its store action', async () => {
    const remove = vi.spyOn(plannerStore.getState(), 'removeSection').mockImplementation(() => {})
    await act(async () => root.render(<ListView />))

    const action = container.querySelector<HTMLButtonElement>('button[aria-label="Remove CSE 100 A01"]')!
    expect(action.className).toContain('min-h-11')
    expect(action.className).toContain('min-w-11')
    await act(async () => action.click())
    expect(remove).toHaveBeenCalledWith('A1')
  })
})
