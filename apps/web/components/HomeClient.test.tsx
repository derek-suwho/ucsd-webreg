// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogData } from '@webreg/catalog'
import { plannerStore } from '@/lib/store'
import HomeClient from './HomeClient'

const TERMS = [
  {
    id: 'FA26',
    name: 'Fall Quarter 2026',
    active: true,
    startsAt: '2026-09-24T00:00:00.000Z',
    endsAt: '2026-12-04T00:00:00.000Z'
  },
  {
    id: 'WI27',
    name: 'Winter Quarter 2027',
    active: false,
    startsAt: '2027-01-04T00:00:00.000Z',
    endsAt: '2027-03-12T00:00:00.000Z'
  }
]

const CATALOG: CatalogData = {
  termId: 'FA26',
  version: 1,
  generatedAt: '2026-08-21T15:30:00.000Z',
  provenance: {
    sourceKind: 'fixture',
    mode: 'demo',
    sourceGeneratedAt: '2026-08-20T12:00:00.000Z'
  },
  courses: {},
  sections: {}
}

function media(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === label)
  if (!match) throw new Error(`missing button: ${label}`)
  return match
}

describe('HomeClient shell', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    plannerStore.setState({
      termId: null,
      terms: [],
      termsStatus: 'idle',
      termsError: null,
      catalog: null,
      index: null,
      catalogStatus: 'idle',
      catalogError: null,
      schedules: [],
      activeScheduleId: null,
      authed: false,
      scheduleSync: {},
      lastError: null
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('flushes pending saves when hidden or page-hidden and removes listeners on unmount', async () => {
    const loadTerms = vi.spyOn(plannerStore.getState(), 'loadTerms').mockResolvedValue()
    const flush = vi.spyOn(plannerStore.getState(), 'flushPendingSaves').mockResolvedValue()
    await act(async () => root.render(<HomeClient authed />))
    expect(loadTerms).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flush).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(flush).toHaveBeenCalledTimes(2)

    await act(async () => root.unmount())
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('renders every API term in a controlled selector and loads the selected term', async () => {
    vi.spyOn(plannerStore.getState(), 'loadTerms').mockResolvedValue()
    const loadTerm = vi.spyOn(plannerStore.getState(), 'loadTerm').mockResolvedValue()
    plannerStore.setState({ terms: TERMS, termsStatus: 'ready', termId: 'FA26' })
    await act(async () => root.render(<HomeClient authed={false} />))

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Academic term"]')
    expect(select?.value).toBe('FA26')
    expect([...select!.options].map(option => [option.value, option.textContent])).toEqual([
      ['FA26', 'Fall Quarter 2026'],
      ['WI27', 'Winter Quarter 2027']
    ])

    await act(async () => {
      select!.value = 'WI27'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(loadTerm).toHaveBeenCalledWith('WI27')
  })

  it('shows retry/empty term states without a phantom option or default schedule', async () => {
    const loadTerms = vi.spyOn(plannerStore.getState(), 'loadTerms').mockResolvedValue()
    const createSchedule = vi.spyOn(plannerStore.getState(), 'createSchedule').mockResolvedValue()
    plannerStore.setState({ termsStatus: 'error', termsError: 'Could not load terms. Try again.' })
    await act(async () => root.render(<HomeClient authed={false} />))
    loadTerms.mockClear()

    await act(async () => button(container, 'Retry terms').click())
    expect(loadTerms).toHaveBeenCalledTimes(1)

    await act(async () => plannerStore.setState({ terms: [], termsStatus: 'ready', termsError: null, termId: null }))
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Academic term"]')
    expect(select?.disabled).toBe(true)
    expect(select?.options).toHaveLength(0)
    expect(container.textContent).toContain('No academic terms available.')
    expect(createSchedule).not.toHaveBeenCalled()
  })

  it('uses truthful guest/account persistence copy and removes inert legacy controls', async () => {
    vi.spyOn(plannerStore.getState(), 'loadTerms').mockResolvedValue()
    await act(async () => root.render(<HomeClient authed={false} />))
    expect(container.textContent).toContain('Schedules are saved in this browser.')

    await act(async () => root.render(<HomeClient authed />))
    expect(container.textContent).toContain('Schedules are saved to your account.')
    expect(container.textContent).not.toContain('Appointment time')
    expect(container.textContent).not.toContain('Enrollment Information')
    expect(container.textContent).not.toContain('View Book List')
    expect(container.textContent).not.toContain('Advanced Search')
    expect([...container.querySelectorAll('button')].some(candidate => candidate.textContent?.trim() === 'Search')).toBe(false)
  })

  it('renders canonical print identity/provenance and disables smooth scrolling for reduced motion', async () => {
    vi.spyOn(plannerStore.getState(), 'loadTerms').mockResolvedValue()
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.stubGlobal('matchMedia', vi.fn((query: string) => media(query === '(prefers-reduced-motion: reduce)')))
    plannerStore.setState({
      terms: TERMS,
      termsStatus: 'ready',
      termId: 'FA26',
      catalog: CATALOG,
      catalogStatus: 'ready',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Primary Plan', sectionIds: [] }],
      activeScheduleId: 's1'
    })

    await act(async () => root.render(<HomeClient authed={false} />))

    const printIdentity = container.querySelector('[aria-label="Printed schedule identity"]')
    expect(printIdentity?.textContent).toContain('Course Planner')
    expect(printIdentity?.textContent).toContain('Fall Quarter 2026')
    expect(printIdentity?.textContent).toContain('Primary Plan')
    expect(printIdentity?.textContent).toContain('Demo catalog — not live seat data')
    expect(printIdentity?.querySelector('time')?.dateTime).toBe('2026-08-21T15:30:00.000Z')
    const printPanel = container.querySelector<HTMLElement>('#tabpanel-list')
    expect(printPanel?.getAttribute('data-print-canonical')).toBe('true')

    await act(async () => button(container, 'Calendar').click())
    expect(printPanel?.getAttribute('aria-hidden')).toBe('true')
    expect(printPanel?.hasAttribute('hidden')).toBe(false)

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Scroll to top"]')!.click())
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})
