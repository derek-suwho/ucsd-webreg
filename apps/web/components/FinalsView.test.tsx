// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { plannerStore } from '@/lib/store'
import { PLANNER_CATALOG } from './__tests__/planner-catalog'
import FinalsView from './FinalsView'

describe('FinalsView accessible grid', () => {
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
  })

  it('bounds its named focusable scroll area so date, time, and corner anchors stay sticky', async () => {
    await act(async () => root.render(<FinalsView conflicts={[]} />))

    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Final exams calendar"]')!
    expect(region.tabIndex).toBe(0)
    expect(region.className).toContain('overflow-auto')
    expect(region.className).toContain('max-h-[min(70vh,44rem)]')
    const hint = document.getElementById(region.getAttribute('aria-describedby')!)!
    expect(hint.textContent).toContain('Scroll horizontally')
    expect(hint.className).not.toContain('sr-only')
    expect(container.querySelector('[data-finals-corner]')?.className).toContain('sticky')
    expect(container.querySelector('[data-finals-date]')?.className).toContain('top-0')
    expect(container.querySelector('[data-finals-time-axis]')?.className).toContain('left-0')
  })

  it('exposes complete exam identity without relying on title text', async () => {
    await act(async () => root.render(<FinalsView conflicts={[]} />))

    const block = container.querySelector<HTMLElement>('[data-finals-block]')!
    expect(block.getAttribute('role')).toBe('group')
    expect(block.getAttribute('aria-label')).toContain('CSE 100 A01')
    expect(block.getAttribute('aria-label')).toContain('Final')
    expect(block.getAttribute('aria-label')).toContain('Mon, Dec 14')
    expect(block.getAttribute('aria-label')).toContain('9:00a–11:00a')
  })
})
