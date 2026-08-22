// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { plannerStore } from '@/lib/store'
import { PLANNER_CATALOG } from '../__tests__/planner-catalog'
import CalendarView from './CalendarView'

describe('CalendarView accessible controls', () => {
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
      schedules: [{ id: 's1', termId: 'FA26', name: 'Primary', sectionIds: ['A1', 'TBA'] }],
      activeScheduleId: 's1',
      authed: false
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  it('bounds its named focusable scroll region so day, time, and corner anchors stay sticky', async () => {
    await act(async () => root.render(<CalendarView conflicts={[]} />))

    const region = container.querySelector<HTMLElement>('[role="region"][aria-label="Weekly schedule calendar"]')!
    expect(region.tabIndex).toBe(0)
    expect(region.className).toContain('overflow-auto')
    expect(region.className).toContain('max-h-[min(70vh,44rem)]')
    const hint = document.getElementById(region.getAttribute('aria-describedby')!)!
    expect(hint.textContent).toContain('Scroll horizontally')
    expect(hint.className).not.toContain('sr-only')
    expect(container.querySelector('[data-calendar-corner]')?.className).toContain('sticky')
    expect(container.querySelector('[data-calendar-corner]')?.className).toContain('left-0')
    expect(container.querySelector('[data-calendar-day]')?.className).toContain('top-0')
    expect(container.querySelector('[data-calendar-time-axis]')?.className).toContain('left-0')
  })

  it('offers one non-drag action row per section, including TBA removal', async () => {
    const swap = vi.spyOn(plannerStore.getState(), 'swapSection').mockImplementation(() => {})
    const remove = vi.spyOn(plannerStore.getState(), 'removeSection').mockImplementation(() => {})
    await act(async () => root.render(<CalendarView conflicts={[]} />))

    const actions = container.querySelector<HTMLElement>('[aria-label="Calendar section actions"]')!
    expect(actions.querySelectorAll('[data-section-action]').length).toBe(2)
    const alternative = actions.querySelector<HTMLSelectElement>('select[aria-label="Alternative for CSE 100 A01"]')!
    expect([...alternative.options].map(option => [option.value, option.text])).toEqual([['A2', 'A02']])
    expect(alternative.className).toContain('min-h-11')

    const swapButton = actions.querySelector<HTMLButtonElement>('button[aria-label="Swap CSE 100 A01 to selected section"]')!
    const removeTba = actions.querySelector<HTMLButtonElement>('button[aria-label="Remove CSE 100 B01"]')!
    expect(swapButton.className).toContain('min-h-11')
    expect(removeTba.className).toContain('min-h-11')

    await act(async () => swapButton.click())
    await act(async () => removeTba.click())
    expect(swap).toHaveBeenCalledWith('A1', 'A2')
    expect(remove).toHaveBeenCalledWith('TBA')
  })
})
