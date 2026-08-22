// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogData } from '@webreg/catalog'
import * as guestStorage from './guest-storage'

function saveLegacyGuest(
  schedules: Array<{ id: string; termId: string; name: string; sectionIds: string[] }>,
  activeScheduleId: string | null
) {
  window.localStorage.setItem('webreg-guest-v1', JSON.stringify({ schedules, activeScheduleId }))
}

const CATALOG: CatalogData = {
  termId: 'FA26',
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  provenance: {
    sourceKind: 'fixture',
    mode: 'demo',
    sourceGeneratedAt: '2026-01-01T00:00:00.000Z'
  },
  courses: {
    C1: { id: 'C1', subject: 'CSE', number: '100', title: 'Intro', unitsFrom: 4, unitsTo: 4, unitsInc: 0, sectionIds: ['LE1', 'DI1', 'DI2'] }
  },
  sections: {
    LE1: { id: 'LE1', courseId: 'C1', code: 'A00', family: 'LE', regNum: 100001, instructor: 'Foo', cap: 100, avail: 10, wait: 0, cancelled: false, meetings: [], exams: [] },
    DI1: { id: 'DI1', courseId: 'C1', code: 'A01', family: 'DI', regNum: 100002, instructor: null, cap: 20, avail: 5, wait: 0, cancelled: false, meetings: [], exams: [] },
    DI2: { id: 'DI2', courseId: 'C1', code: 'A02', family: 'DI', regNum: 100003, instructor: null, cap: 20, avail: 0, wait: 0, cancelled: false, meetings: [], exams: [] }
  }
}

const TERMS = [
  {
    id: 'FA26',
    name: 'Fall Quarter 2026',
    active: false,
    startsAt: '2026-09-24T00:00:00.000Z',
    endsAt: '2026-12-04T00:00:00.000Z'
  },
  {
    id: 'WI27',
    name: 'Winter Quarter 2027',
    active: true,
    startsAt: '2027-01-04T00:00:00.000Z',
    endsAt: '2027-03-12T00:00:00.000Z'
  }
]

function catalogResponse(etag = '"v1"') {
  return new Response(JSON.stringify(CATALOG), { status: 200, headers: { ETag: etag } })
}

const STALE_INDEX = {
  exactMap: new Map<string, string>(),
  subjects: [],
  subjectCourses: new Map<string, string[]>(),
  regNumMap: new Map<number, string>(),
  titleEntries: [],
  instructorEntries: []
}

describe('planner store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('loads API terms and retains the current term when it remains valid', async () => {
    vi.resetModules()
    const winter = { ...CATALOG, termId: 'WI27' }
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/terms') return Promise.resolve(new Response(JSON.stringify({ terms: TERMS }), { status: 200 }))
      if (url === '/api/catalog/WI27') {
        return Promise.resolve(new Response(JSON.stringify(winter), { status: 200, headers: { ETag: '"wi"' } }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({ termId: 'WI27' })

    await plannerStore.getState().loadTerms()

    expect(plannerStore.getState()).toMatchObject({
      terms: TERMS,
      termsStatus: 'ready',
      termsError: null,
      termId: 'WI27',
      catalog: winter
    })
  })

  it('selects the first active API term, then the first term when none are active', async () => {
    vi.resetModules()
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/terms') return Promise.resolve(new Response(JSON.stringify({ terms: TERMS }), { status: 200 }))
      if (url === '/api/catalog/WI27') {
        return Promise.resolve(new Response(JSON.stringify({ ...CATALOG, termId: 'WI27' }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    await plannerStore.getState().loadTerms()
    expect(plannerStore.getState().termId).toBe('WI27')

    vi.resetModules()
    const inactiveTerms = TERMS.map(term => ({ ...term, active: false }))
    const firstFetch = vi.fn((url: string) => {
      if (url === '/api/terms') {
        return Promise.resolve(new Response(JSON.stringify({ terms: inactiveTerms }), { status: 200 }))
      }
      if (url === '/api/catalog/FA26') return Promise.resolve(catalogResponse())
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', firstFetch)
    const { plannerStore: freshStore } = await import('./store')

    await freshStore.getState().loadTerms()
    expect(freshStore.getState().termId).toBe('FA26')
  })

  it('exposes retryable term errors and clears phantom term state for an empty response', async () => {
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ terms: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    await expect(plannerStore.getState().loadTerms()).resolves.toBeUndefined()
    expect(plannerStore.getState()).toMatchObject({
      termId: null,
      terms: [],
      termsStatus: 'error',
      termsError: 'Could not load terms. Try again.'
    })

    await plannerStore.getState().loadTerms()
    expect(plannerStore.getState()).toMatchObject({
      termId: null,
      terms: [],
      termsStatus: 'ready',
      termsError: null,
      catalog: null,
      schedules: [],
      activeScheduleId: null
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loadTerm fetches the catalog and builds the search index', async () => {
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    await plannerStore.getState().loadTerm('FA26')

    expect(fetchMock).toHaveBeenCalledWith('/api/catalog/FA26', {
      headers: {},
      signal: expect.any(AbortSignal)
    })
    const state = plannerStore.getState()
    expect(state.termId).toBe('FA26')
    expect(state.catalog).toEqual(CATALOG)
    expect(state.index?.exactMap.get('cse100')).toBe('C1')
  })

  it('loadTerm keeps existing catalog on a 304', async () => {
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(catalogResponse())
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"v1"' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    await plannerStore.getState().loadTerm('FA26')
    const afterFirst = plannerStore.getState().catalog
    await plannerStore.getState().loadTerm('FA26')

    expect(plannerStore.getState().catalog).toBe(afterFirst)
  })

  it('loadTerm clears stale catalog and index before the request settles', async () => {
    vi.resetModules()
    let resolveResponse!: (response: Response) => void
    const pending = new Promise<Response>(resolve => {
      resolveResponse = resolve
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(pending))
    const { plannerStore } = await import('./store')
    plannerStore.setState({ catalog: CATALOG, index: STALE_INDEX })

    const loading = plannerStore.getState().loadTerm('WI27')

    expect(plannerStore.getState()).toMatchObject({
      termId: 'WI27',
      catalog: null,
      index: null,
      catalogStatus: 'loading',
      catalogError: null
    })

    resolveResponse(catalogResponse('"v1"'))
    await loading
  })

  it('loadTerm exposes a retryable error and resolves instead of leaking a rejection', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const { plannerStore } = await import('./store')
    plannerStore.setState({ catalog: CATALOG, index: STALE_INDEX })

    await expect(plannerStore.getState().loadTerm('FA26')).resolves.toBeUndefined()

    expect(plannerStore.getState()).toMatchObject({
      termId: 'FA26',
      catalog: null,
      index: null,
      catalogStatus: 'error',
      catalogError: 'Could not load catalog. Try again.'
    })
  })

  it('loadTerm can retry after an error', async () => {
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(catalogResponse())
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    await plannerStore.getState().loadTerm('FA26')
    expect(plannerStore.getState().catalogStatus).toBe('error')

    await plannerStore.getState().loadTerm('FA26')
    expect(plannerStore.getState()).toMatchObject({
      catalog: CATALOG,
      catalogStatus: 'ready',
      catalogError: null
    })
  })

  it('loadTerm ignores an older response that settles after the selected term', async () => {
    vi.resetModules()
    const winter = { ...CATALOG, termId: 'WI27', version: 2 }
    let resolveFall!: (response: Response) => void
    let resolveWinter!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveFall = resolve }))
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveWinter = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    const fallLoad = plannerStore.getState().loadTerm('FA26')
    const winterLoad = plannerStore.getState().loadTerm('WI27')
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    resolveWinter(new Response(JSON.stringify(winter), { status: 200, headers: { ETag: '"wi"' } }))
    await winterLoad
    resolveFall(catalogResponse('"fa"'))
    await fallLoad

    expect(plannerStore.getState()).toMatchObject({
      termId: 'WI27',
      catalog: winter,
      catalogStatus: 'ready',
      catalogError: null
    })
  })

  it('loadTerm selects only guest schedules stored for that term', async () => {
    saveLegacyGuest(
      [
        { id: 'guest-1', termId: 'FA26', name: 'Fall', sectionIds: ['LE1'] },
        { id: 'guest-2', termId: 'WI27', name: 'Winter', sectionIds: [] }
      ],
      'guest-2'
    )
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))
    const { plannerStore } = await import('./store')

    await plannerStore.getState().loadTerm('FA26')

    expect(plannerStore.getState().schedules).toEqual([{ id: 'guest-1', termId: 'FA26', name: 'Fall', sectionIds: ['LE1'] }])
    expect(plannerStore.getState().activeScheduleId).toBe('guest-1')
  })

  it('hydrates and loads safely when guest storage access throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))

    const { plannerStore } = await import('./store')
    await expect(plannerStore.getState().loadTerm('FA26')).resolves.toBeUndefined()

    expect(plannerStore.getState()).toMatchObject({
      schedules: [],
      activeScheduleId: null,
      catalog: CATALOG,
      catalogStatus: 'ready',
      catalogError: null
    })
  })

  it('hydrates malformed nested guest data as empty and completes term loading', async () => {
    window.localStorage.setItem('webreg-guest-v1', JSON.stringify({ schedules: [null], activeScheduleId: null }))
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))

    const { plannerStore } = await import('./store')
    expect(plannerStore.getState()).toMatchObject({
      schedules: [],
      activeScheduleId: null,
      catalogStatus: 'idle'
    })

    await expect(plannerStore.getState().loadTerm('FA26')).resolves.toBeUndefined()
    expect(plannerStore.getState()).toMatchObject({
      catalog: CATALOG,
      catalogStatus: 'ready',
      catalogError: null
    })
  })

  it('addSelection uses planSelection to set the chosen section and replaces prior family picks', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      catalog: CATALOG,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: [] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().addSelection('C1', 'DI', 'DI1')
    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['DI1'])

    plannerStore.getState().addSelection('C1', 'DI', 'DI2')
    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['DI2'])
  })

  it('addSelection throws when the section is not a member of the family', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      catalog: CATALOG,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: [] }],
      activeScheduleId: 's1'
    })

    expect(() => plannerStore.getState().addSelection('C1', 'DI', 'LE1')).toThrow()
  })

  it('removeSection removes a section from the active schedule', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['LE1', 'DI1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('DI1')
    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['LE1'])
  })

  it('swapSection replaces one section id with another in place', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['LE1', 'DI1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('DI1', 'DI2')
    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['LE1', 'DI2'])
  })

  it('guest mode mirrors schedule mutations to localStorage under webreg-guest-v1', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({ termId: 'FA26', authed: false })

    await plannerStore.getState().createSchedule('My Schedule')
    const id = plannerStore.getState().activeScheduleId!

    const stored = guestStorage.load()
    expect(stored?.terms.FA26).toEqual({
      schedules: [{ id, name: 'My Schedule', sectionIds: [] }],
      activeScheduleId: id
    })
  })

  it('rehydrates guest schedules from localStorage on store init', async () => {
    saveLegacyGuest(
      [{ id: 'guest-3', termId: 'FA26', name: 'Saved', sectionIds: ['LE1'] }],
      'guest-3'
    )

    vi.resetModules()
    const { plannerStore: freshStore } = await import('./store')

    expect(freshStore.getState().schedules).toEqual([])
    expect(freshStore.getState().activeScheduleId).toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(catalogResponse()))
    await freshStore.getState().loadTerm('FA26')
    expect(freshStore.getState().schedules).toEqual([{ id: 'guest-3', termId: 'FA26', name: 'Saved', sectionIds: ['LE1'] }])
    expect(freshStore.getState().activeScheduleId).toBe('guest-3')
  })

  it('round-trips independent guest schedules and active IDs across term switches', async () => {
    guestStorage.save({
      version: 2,
      terms: {
        FA26: {
          schedules: [
            { id: 'guest-1', name: 'Fall 1', sectionIds: ['LE1'] },
            { id: 'guest-2', name: 'Fall 2', sectionIds: [] }
          ],
          activeScheduleId: 'guest-2'
        },
        WI27: {
          schedules: [{ id: 'guest-3', name: 'Winter', sectionIds: [] }],
          activeScheduleId: 'guest-3'
        }
      }
    })
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const termId = url.includes('WI27') ? 'WI27' : 'FA26'
      return new Response(JSON.stringify({ ...CATALOG, termId }), { status: 200, headers: { ETag: `"${termId}"` } })
    }))
    const { plannerStore } = await import('./store')

    await plannerStore.getState().loadTerm('FA26')
    expect(plannerStore.getState()).toMatchObject({
      activeScheduleId: 'guest-2',
      schedules: [
        { id: 'guest-1', termId: 'FA26', name: 'Fall 1', sectionIds: ['LE1'] },
        { id: 'guest-2', termId: 'FA26', name: 'Fall 2', sectionIds: [] }
      ]
    })
    await plannerStore.getState().renameSchedule('guest-2', 'Fall renamed')

    await plannerStore.getState().loadTerm('WI27')
    expect(plannerStore.getState()).toMatchObject({
      activeScheduleId: 'guest-3',
      schedules: [{ id: 'guest-3', termId: 'WI27', name: 'Winter', sectionIds: [] }]
    })
    await plannerStore.getState().createSchedule('Winter 2')

    await plannerStore.getState().loadTerm('FA26')
    expect(plannerStore.getState()).toMatchObject({
      activeScheduleId: 'guest-2',
      schedules: [
        { id: 'guest-1', termId: 'FA26', name: 'Fall 1', sectionIds: ['LE1'] },
        { id: 'guest-2', termId: 'FA26', name: 'Fall renamed', sectionIds: [] }
      ]
    })
    expect(guestStorage.load()?.terms.WI27?.schedules).toHaveLength(2)
  })

  it('loadTerm fetches authenticated schedules and ignores a stale prior-term fetch', async () => {
    vi.resetModules()
    let resolveFallSchedules!: (response: Response) => void
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/catalog/FA26') return Promise.resolve(catalogResponse('"fa"'))
      if (url === '/api/catalog/WI27') {
        return Promise.resolve(new Response(JSON.stringify({ ...CATALOG, termId: 'WI27' }), { status: 200, headers: { ETag: '"wi"' } }))
      }
      if (url === '/api/schedules?term=FA26') {
        return new Promise<Response>(resolve => { resolveFallSchedules = resolve })
      }
      if (url === '/api/schedules?term=WI27') {
        return Promise.resolve(new Response(JSON.stringify({
          schedules: [{ id: 'wi-1', termId: 'WI27', name: 'Winter', items: [] }]
        }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.getState().setAuthed(true)

    const fall = plannerStore.getState().loadTerm('FA26')
    const winter = plannerStore.getState().loadTerm('WI27')
    await winter
    resolveFallSchedules(new Response(JSON.stringify({
      schedules: [{ id: 'fa-1', termId: 'FA26', name: 'Fall', items: [] }]
    }), { status: 200 }))
    await fall

    expect(plannerStore.getState()).toMatchObject({
      termId: 'WI27',
      activeScheduleId: 'wi-1',
      schedules: [{ id: 'wi-1', termId: 'WI27', name: 'Winter', sectionIds: [] }]
    })
  })

  it('authenticated initial effects can refetch twice without losing a valid active schedule', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/catalog/FA26') return catalogResponse()
      if (url === '/api/schedules?term=FA26') {
        return new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'One', items: [] },
          { id: 's2', termId: 'FA26', name: 'Two', items: [] }
        ] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    const loading = plannerStore.getState().loadTerm('FA26')
    plannerStore.getState().setAuthed(true)
    await loading
    plannerStore.getState().setActive('s2')
    await plannerStore.getState().refetchSchedules()

    expect(plannerStore.getState().activeScheduleId).toBe('s2')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/schedules?')).length).toBeGreaterThanOrEqual(2)
  })

  it('does not create an authenticated default when initial schedule truth is unknown', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/schedules?term=FA26') {
        return new Response(JSON.stringify({ error: 'offline' }), { status: 503 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({ authed: true, termId: 'FA26', schedules: [], activeScheduleId: null })

    const fetching = plannerStore.getState().refetchSchedules()
    await plannerStore.getState().createSchedule('My Schedule')
    await fetching

    expect(plannerStore.getState()).toMatchObject({
      schedules: [],
      activeScheduleId: null,
      lastError: 'Could not load schedules'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refetch picks the first server schedule when active is invalid and rejects cross-term activation', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schedules: [
      { id: 's1', termId: 'FA26', name: 'One', items: [] },
      { id: 's2', termId: 'FA26', name: 'Two', items: [] }
    ] }), { status: 200 })))
    const { plannerStore } = await import('./store')
    plannerStore.setState({ authed: true, termId: 'FA26', activeScheduleId: 'missing' })

    await plannerStore.getState().refetchSchedules()
    expect(plannerStore.getState().activeScheduleId).toBe('s1')
    expect(plannerStore.getState().schedules.map(schedule => schedule.id)).toEqual(['s1', 's2'])

    plannerStore.getState().setActive('wrong')
    expect(plannerStore.getState().activeScheduleId).toBe('s1')
  })

  it('sign-out invalidates an authenticated fetch and hydrates only current-term guest data', async () => {
    guestStorage.save({
      version: 2,
      terms: {
        FA26: {
          schedules: [{ id: 'guest-1', name: 'Local', sectionIds: [] }],
          activeScheduleId: 'guest-1'
        },
        WI27: {
          schedules: [{ id: 'guest-2', name: 'Other term', sectionIds: [] }],
          activeScheduleId: 'guest-2'
        }
      }
    })
    vi.resetModules()
    let resolveSchedules!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { resolveSchedules = resolve })))
    const { plannerStore } = await import('./store')
    plannerStore.setState({ termId: 'FA26', authed: true })

    const pending = plannerStore.getState().refetchSchedules()
    plannerStore.getState().setAuthed(false)
    resolveSchedules(new Response(JSON.stringify({ schedules: [
      { id: 'server-1', termId: 'FA26', name: 'Server', items: [] }
    ] }), { status: 200 }))
    await pending

    expect(plannerStore.getState()).toMatchObject({
      authed: false,
      activeScheduleId: 'guest-1',
      schedules: [{ id: 'guest-1', termId: 'FA26', name: 'Local', sectionIds: [] }]
    })
  })

  it('rejects oversized authenticated schedule lists without replacing local truth', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schedules: Array.from({ length: 21 }, (_, index) => ({
        id: `s${index}`,
        termId: 'FA26',
        name: `Schedule ${index}`,
        items: []
      }))
    }), { status: 200 })))
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 'existing', termId: 'FA26', name: 'Existing', sectionIds: [] }],
      activeScheduleId: 'existing'
    })

    await plannerStore.getState().refetchSchedules()

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 'existing', termId: 'FA26', name: 'Existing', sectionIds: [] }],
      activeScheduleId: 'existing'
    })
  })

  it('rejects a cross-term authenticated response without exposing any of it', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ schedules: [
      { id: 's1', termId: 'FA26', name: 'One', items: [] },
      { id: 'wrong', termId: 'WI27', name: 'Wrong term', items: [] }
    ] }), { status: 200 })))
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 'existing', termId: 'FA26', name: 'Existing', sectionIds: [] }],
      activeScheduleId: 'existing'
    })

    await plannerStore.getState().refetchSchedules()

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 'existing', termId: 'FA26', name: 'Existing', sectionIds: [] }],
      activeScheduleId: 'existing'
    })
  })

  it('deleting an active guest schedule selects its next neighbor', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: false,
      termId: 'FA26',
      schedules: [
        { id: 's1', termId: 'FA26', name: 'One', sectionIds: [] },
        { id: 's2', termId: 'FA26', name: 'Two', sectionIds: [] },
        { id: 's3', termId: 'FA26', name: 'Three', sectionIds: [] }
      ],
      activeScheduleId: 's2'
    })

    await plannerStore.getState().deleteSchedule('s2')

    expect(plannerStore.getState().activeScheduleId).toBe('s3')
    expect(plannerStore.getState().schedules.map(schedule => schedule.id)).toEqual(['s1', 's3'])
  })

  it('does not create guest schedules beyond the bounded per-term limit', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    const schedules = Array.from({ length: 20 }, (_, index) => ({
      id: `guest-${index + 1}`,
      termId: 'FA26',
      name: `Plan ${index + 1}`,
      sectionIds: []
    }))
    plannerStore.setState({ authed: false, termId: 'FA26', schedules, activeScheduleId: 'guest-1' })

    await plannerStore.getState().createSchedule('One too many')

    expect(plannerStore.getState().schedules).toEqual(schedules)
    expect(plannerStore.getState().lastError).toBe('Schedule limit reached')
  })

  it('rejects invalid guest schedule names before changing state or storage', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({ authed: false, termId: 'FA26', schedules: [], activeScheduleId: null })

    await plannerStore.getState().createSchedule('x'.repeat(61))

    expect(plannerStore.getState()).toMatchObject({ schedules: [], lastError: 'Invalid schedule name' })
    expect(guestStorage.load()).toBeNull()
  })

  it('deleting the final guest schedule creates a default only in the current term', async () => {
    guestStorage.save({
      version: 2,
      terms: {
        WI27: {
          schedules: [{ id: 'winter', name: 'Winter', sectionIds: [] }],
          activeScheduleId: 'winter'
        }
      }
    })
    vi.resetModules()
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: false,
      termId: 'FA26',
      schedules: [{ id: 'fall', termId: 'FA26', name: 'Fall', sectionIds: [] }],
      activeScheduleId: 'fall'
    })

    await plannerStore.getState().deleteSchedule('fall')

    const state = plannerStore.getState()
    expect(state.schedules).toEqual([
      expect.objectContaining({ termId: 'FA26', name: 'My Schedule', sectionIds: [] })
    ])
    expect(state.activeScheduleId).toBe(state.schedules[0].id)
    expect(guestStorage.load()?.terms.WI27).toEqual({
      schedules: [{ id: 'winter', name: 'Winter', sectionIds: [] }],
      activeScheduleId: 'winter'
    })
  })

  it('authenticated default creation failure after deleting last is honest and leaves no phantom', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url === '/api/schedules' && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'failed' }), { status: 500 })
      }
      if (url === '/api/schedules?term=FA26') {
        return new Response(JSON.stringify({ schedules: [] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Only', sectionIds: [] }],
      activeScheduleId: 's1'
    })

    await plannerStore.getState().deleteSchedule('s1')

    expect(plannerStore.getState()).toMatchObject({
      schedules: [],
      activeScheduleId: null,
      lastError: 'Failed to create schedule'
    })
  })

  it('single-flights delete-last and Home default creation for one term', async () => {
    vi.resetModules()
    let resolveCreate!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }
      if (url === '/api/schedules' && init?.method === 'POST') {
        return new Promise<Response>(resolve => { resolveCreate = resolve })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Only', sectionIds: [] }],
      activeScheduleId: 's1'
    })

    const deleting = plannerStore.getState().deleteSchedule('s1')
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/schedules')).toBe(true))
    const homeEffect = plannerStore.getState().createSchedule('My Schedule')

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/schedules')).toHaveLength(1)
    resolveCreate(new Response(JSON.stringify({
      id: 's2', termId: 'FA26', name: 'My Schedule', items: []
    }), { status: 201 }))
    await Promise.all([deleting, homeEffect])

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/schedules')).toHaveLength(1)
    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's2', termId: 'FA26', name: 'My Schedule', sectionIds: [] }],
      activeScheduleId: 's2'
    })
  })

  it('deleting a schedule cancels its pending authenticated item write', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url === '/api/schedules' && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 's2', termId: 'FA26', name: 'My Schedule', items: [] }), { status: 201 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Only', sectionIds: ['LE1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('LE1')
    await plannerStore.getState().deleteSchedule('s1')
    await vi.advanceTimersByTimeAsync(800)

    expect(fetchMock.mock.calls.some(([url]) => url === '/api/schedules/s1/items')).toBe(false)
    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's2', termId: 'FA26', name: 'My Schedule', sectionIds: [] }],
      activeScheduleId: 's2'
    })
  })

  it('failed delete retains the pending latest item write', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ error: 'failed' }), { status: 500 })
      }
      if (url === '/api/schedules/s1/items' && init?.method === 'PUT') {
        return new Response(JSON.stringify({ id: 's1', items: [] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Only', sectionIds: ['LE1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('LE1')
    await plannerStore.getState().deleteSchedule('s1')
    expect(plannerStore.getState().scheduleSync.s1).toBe('pending')
    await vi.advanceTimersByTimeAsync(800)

    const itemWrite = fetchMock.mock.calls.find(([url]) => url === '/api/schedules/s1/items')
    expect(itemWrite).toBeDefined()
    expect(JSON.parse(itemWrite![1]!.body as string)).toEqual({ sectionIds: [] })
    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's1', termId: 'FA26', name: 'Only', sectionIds: [] }],
      activeScheduleId: 's1',
      lastError: 'Failed to delete schedule'
    })
  })

  it('rejects a cross-term rename response and restores current-term server truth', async () => {
    vi.resetModules()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ id: 's1', termId: 'WI27', name: 'Renamed', items: [] }), { status: 200 })
      }
      if (url === '/api/schedules?term=FA26') {
        return new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'Original', items: [] }
        ] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Original', sectionIds: [] }],
      activeScheduleId: 's1'
    })

    await plannerStore.getState().renameSchedule('s1', 'Renamed')

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's1', termId: 'FA26', name: 'Original', sectionIds: [] }],
      activeScheduleId: 's1',
      lastError: 'Failed to rename schedule'
    })
  })

  it('keeps the latest rename when an older success resolves last', async () => {
    vi.resetModules()
    let resolveA!: (response: Response) => void
    let resolveB!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'PATCH') {
        const { name } = JSON.parse(init.body as string)
        return new Promise<Response>(resolve => {
          if (name === 'A') resolveA = resolve
          else resolveB = resolve
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Original', sectionIds: [] }],
      activeScheduleId: 's1',
      lastError: null
    })

    const renameA = plannerStore.getState().renameSchedule('s1', 'A')
    const renameB = plannerStore.getState().renameSchedule('s1', 'B')
    resolveB(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'B', items: [] }), { status: 200 }))
    await renameB
    resolveA(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'A', items: [] }), { status: 200 }))
    await renameA

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's1', termId: 'FA26', name: 'B', sectionIds: [] }],
      lastError: null
    })
  })

  it('ignores an older rename failure after the latest rename succeeds', async () => {
    vi.resetModules()
    let resolveA!: (response: Response) => void
    let resolveB!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'PATCH') {
        const { name } = JSON.parse(init.body as string)
        return new Promise<Response>(resolve => {
          if (name === 'A') resolveA = resolve
          else resolveB = resolve
        })
      }
      if (url === '/api/schedules?term=FA26') {
        return Promise.resolve(new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'B', items: [] }
        ] }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Original', sectionIds: [] }],
      activeScheduleId: 's1',
      lastError: null
    })

    const renameA = plannerStore.getState().renameSchedule('s1', 'A')
    const renameB = plannerStore.getState().renameSchedule('s1', 'B')
    resolveB(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'B', items: [] }), { status: 200 }))
    await renameB
    resolveA(new Response(JSON.stringify({ error: 'failed' }), { status: 500 }))
    await renameA

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's1', termId: 'FA26', name: 'B', sectionIds: [] }],
      lastError: null
    })
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/schedules?term=FA26')).toBe(false)
  })

  it('ignores a stale rename after leaving and returning to its term', async () => {
    vi.resetModules()
    let resolveA!: (response: Response) => void
    let resolveB!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'PATCH') {
        const { name } = JSON.parse(init.body as string)
        return new Promise<Response>(resolve => {
          if (name === 'A') resolveA = resolve
          else resolveB = resolve
        })
      }
      if (url === '/api/schedules?term=WI27') {
        return Promise.resolve(new Response(JSON.stringify({ schedules: [] }), { status: 200 }))
      }
      if (url === '/api/schedules?term=FA26') {
        return Promise.resolve(new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'Original', items: [] }
        ] }), { status: 200 }))
      }
      if (url === '/api/catalog/WI27') {
        return Promise.resolve(new Response(JSON.stringify({ ...CATALOG, termId: 'WI27' }), { status: 200 }))
      }
      if (url === '/api/catalog/FA26') return Promise.resolve(catalogResponse())
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Original', sectionIds: [] }],
      activeScheduleId: 's1',
      lastError: null
    })

    const renameA = plannerStore.getState().renameSchedule('s1', 'A')
    await plannerStore.getState().loadTerm('WI27')
    await plannerStore.getState().loadTerm('FA26')
    const renameB = plannerStore.getState().renameSchedule('s1', 'B')
    resolveB(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'B', items: [] }), { status: 200 }))
    await renameB
    resolveA(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'A', items: [] }), { status: 200 }))
    await renameA

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's1', termId: 'FA26', name: 'B', sectionIds: [] }],
      lastError: null
    })
  })

  it('ignores a stale rename after signing out and back in', async () => {
    vi.resetModules()
    let resolveA!: (response: Response) => void
    let resolveB!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1' && init?.method === 'PATCH') {
        const { name } = JSON.parse(init.body as string)
        return new Promise<Response>(resolve => {
          if (name === 'A') resolveA = resolve
          else resolveB = resolve
        })
      }
      if (url === '/api/schedules?term=FA26') {
        return Promise.resolve(new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'Original', items: [] }
        ] }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Original', sectionIds: [] }],
      activeScheduleId: 's1',
      lastError: null
    })

    const renameA = plannerStore.getState().renameSchedule('s1', 'A')
    plannerStore.getState().setAuthed(false)
    plannerStore.getState().setAuthed(true)
    await vi.waitFor(() => expect(plannerStore.getState().schedules[0]?.name).toBe('Original'))
    const renameB = plannerStore.getState().renameSchedule('s1', 'B')
    resolveB(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'B', items: [] }), { status: 200 }))
    await renameB
    resolveA(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'A', items: [] }), { status: 200 }))
    await renameA

    expect(plannerStore.getState()).toMatchObject({
      schedules: [{ id: 's1', termId: 'FA26', name: 'B', sectionIds: [] }],
      lastError: null
    })
  })

  it('authed mode debounces item PUTs 800ms and sends only the latest sectionIds', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 's1', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A', 'B'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('A', 'X')
    await vi.advanceTimersByTimeAsync(500)
    plannerStore.getState().swapSection('X', 'Y')

    await vi.advanceTimersByTimeAsync(799)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/schedules/s1/items')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ sectionIds: ['Y', 'B'] })
  })

  it('marks an authenticated item edit pending until its save succeeds', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 's1', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['LE1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('LE1')

    expect(plannerStore.getState().scheduleSync).toEqual({ s1: 'pending' })
    await vi.advanceTimersByTimeAsync(800)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', keepalive: true })
    expect(plannerStore.getState().scheduleSync).toEqual({ s1: 'saved' })
  })

  it('keeps an acknowledged edit over a refetch that began before the edit', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let resolveRefetch!: (response: Response) => void
    let refetchCount = 0
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules?term=FA26') {
        refetchCount += 1
        if (refetchCount === 1) return new Promise<Response>(resolve => { resolveRefetch = resolve })
        return Promise.resolve(new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'Sched', items: [{ sectionId: 'C', status: 'planned' }] }
        ] }), { status: 200 }))
      }
      if (url === '/api/schedules/s1/items' && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({
          id: 's1',
          items: [{ sectionId: 'B', status: 'planned' }]
        }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    const refetch = plannerStore.getState().refetchSchedules()
    plannerStore.getState().swapSection('A', 'B')
    await vi.advanceTimersByTimeAsync(800)
    expect(plannerStore.getState().scheduleSync.s1).toBe('saved')

    resolveRefetch(new Response(JSON.stringify({ schedules: [
      { id: 's1', termId: 'FA26', name: 'Sched', items: [{ sectionId: 'A', status: 'planned' }] }
    ] }), { status: 200 }))
    await refetch

    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['B'])
    expect(plannerStore.getState().scheduleSync.s1).toBe('saved')

    await plannerStore.getState().refetchSchedules()
    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['C'])
  })

  it('preserves current items when rename returns a stale item list after save acknowledgement', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1/items' && init?.method === 'PUT') {
        return Promise.resolve(new Response(JSON.stringify({
          id: 's1',
          items: [{ sectionId: 'B', status: 'planned' }]
        }), { status: 200 }))
      }
      if (url === '/api/schedules/s1' && init?.method === 'PATCH') {
        return Promise.resolve(new Response(JSON.stringify({
          id: 's1',
          termId: 'FA26',
          name: 'Renamed',
          items: [{ sectionId: 'A', status: 'planned' }]
        }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('A', 'B')
    await vi.advanceTimersByTimeAsync(800)
    expect(plannerStore.getState().scheduleSync.s1).toBe('saved')

    await plannerStore.getState().renameSchedule('s1', 'Renamed')

    expect(plannerStore.getState().schedules[0]).toMatchObject({ name: 'Renamed', sectionIds: ['B'] })
  })

  it('serializes same-schedule saves and sends only the latest queued payload', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let resolveFirst!: (response: Response) => void
    let resolveSecond!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveSecond = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('A', 'B')
    await vi.advanceTimersByTimeAsync(800)
    plannerStore.getState().swapSection('B', 'C')
    await vi.advanceTimersByTimeAsync(800)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sectionIds: ['B'] })

    resolveFirst(new Response(JSON.stringify({ id: 's1', items: [{ sectionId: 'B', status: 'planned' }] }), { status: 200 }))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sectionIds: ['C'] })
    expect(plannerStore.getState().scheduleSync.s1).toBe('pending')

    resolveSecond(new Response(JSON.stringify({ id: 's1', items: [{ sectionId: 'C', status: 'planned' }] }), { status: 200 }))
    await vi.waitFor(() => expect(plannerStore.getState().scheduleSync.s1).toBe('saved'))
  })

  it('drains a newer revision after an older in-flight revision fails', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let resolveFirst!: (response: Response) => void
    let resolveSecond!: (response: Response) => void
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveFirst = resolve }))
      .mockReturnValueOnce(new Promise<Response>(resolve => { resolveSecond = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('A', 'B')
    await vi.advanceTimersByTimeAsync(800)
    plannerStore.getState().swapSection('B', 'C')
    await vi.advanceTimersByTimeAsync(800)
    resolveFirst(new Response(JSON.stringify({ error: 'failed' }), { status: 500 }))

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(plannerStore.getState().scheduleSync.s1).toBe('pending')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sectionIds: ['C'] })
    resolveSecond(new Response(JSON.stringify({ id: 's1', items: [{ sectionId: 'C', status: 'planned' }] }), { status: 200 }))
    await vi.waitFor(() => expect(plannerStore.getState().scheduleSync.s1).toBe('saved'))
  })

  it('retains the latest failed payload and retries it explicitly', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'failed' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 's1', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['LE1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('LE1')
    await vi.advanceTimersByTimeAsync(800)
    expect(plannerStore.getState().scheduleSync.s1).toBe('failed')

    const retry = plannerStore.getState().retryScheduleSave('s1')
    expect(plannerStore.getState().scheduleSync.s1).toBe('pending')
    await retry

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sectionIds: [] })
    expect(plannerStore.getState().scheduleSync.s1).toBe('saved')
  })

  it('debounces authenticated schedules independently', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [
        { id: 's1', termId: 'FA26', name: 'One', sectionIds: ['A'] },
        { id: 's2', termId: 'FA26', name: 'Two', sectionIds: ['B'] }
      ],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('A')
    await vi.advanceTimersByTimeAsync(400)
    plannerStore.getState().setActive('s2')
    plannerStore.getState().removeSection('B')
    await vi.advanceTimersByTimeAsync(400)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/schedules/s1/items'])

    await vi.advanceTimersByTimeAsync(400)
    expect(fetchMock.mock.calls.map(([url]) => url).sort()).toEqual([
      '/api/schedules/s1/items',
      '/api/schedules/s2/items'
    ])
  })

  it('flushes debounced saves immediately with keepalive', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 's1', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['LE1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('LE1')
    await plannerStore.getState().flushPendingSaves()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', keepalive: true })
    expect(plannerStore.getState().scheduleSync.s1).toBe('saved')
  })

  it('deduplicates lifecycle flushes while the same revision is in flight', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let resolveSave!: (response: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>(resolve => { resolveSave = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['LE1'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('LE1')
    await vi.advanceTimersByTimeAsync(800)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', keepalive: true })
    const firstFlush = plannerStore.getState().flushPendingSaves()
    const secondFlush = plannerStore.getState().flushPendingSaves()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveSave(new Response(JSON.stringify({ id: 's1', items: [] }), { status: 200 }))
    await Promise.all([firstFlush, secondFlush])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(plannerStore.getState().scheduleSync.s1).toBe('saved')
  })

  it('overlays unsynced items when schedule refetch returns older server truth', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/schedules?term=FA26') {
        return new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'Sched', items: [{ sectionId: 'A', status: 'planned' }] }
        ] }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('A', 'B')
    await plannerStore.getState().refetchSchedules()

    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['B'])
    expect(plannerStore.getState().scheduleSync.s1).toBe('pending')
  })

  it('preserves a queued snapshot through a term round-trip', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let resolveSave!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1/items' && init?.method === 'PUT') {
        return new Promise<Response>(resolve => { resolveSave = resolve })
      }
      if (url === '/api/catalog/WI27') {
        return Promise.resolve(new Response(JSON.stringify({ ...CATALOG, termId: 'WI27' }), { status: 200 }))
      }
      if (url === '/api/catalog/FA26') return Promise.resolve(catalogResponse())
      if (url === '/api/schedules?term=WI27') {
        return Promise.resolve(new Response(JSON.stringify({ schedules: [
          { id: 'w1', termId: 'WI27', name: 'Winter', items: [] }
        ] }), { status: 200 }))
      }
      if (url === '/api/schedules?term=FA26') {
        return Promise.resolve(new Response(JSON.stringify({ schedules: [
          { id: 's1', termId: 'FA26', name: 'Fall', items: [{ sectionId: 'A', status: 'planned' }] }
        ] }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Fall', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().swapSection('A', 'B')
    await vi.advanceTimersByTimeAsync(800)
    await plannerStore.getState().loadTerm('WI27')
    await plannerStore.getState().loadTerm('FA26')

    expect(plannerStore.getState().schedules[0].sectionIds).toEqual(['B'])
    expect(plannerStore.getState().scheduleSync.s1).toBe('pending')
    resolveSave(new Response(JSON.stringify({ id: 's1', items: [{ sectionId: 'B', status: 'planned' }] }), { status: 200 }))
    await vi.waitFor(() => expect(plannerStore.getState().scheduleSync.s1).toBe('saved'))
  })

  it('successful deletion invalidates an older in-flight save completion', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    let resolveSave!: (response: Response) => void
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/schedules/s1/items' && init?.method === 'PUT') {
        return new Promise<Response>(resolve => { resolveSave = resolve })
      }
      if (url === '/api/schedules/s1' && init?.method === 'DELETE') {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [
        { id: 's1', termId: 'FA26', name: 'One', sectionIds: ['A'] },
        { id: 's2', termId: 'FA26', name: 'Two', sectionIds: [] }
      ],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('A')
    await vi.advanceTimersByTimeAsync(800)
    await plannerStore.getState().deleteSchedule('s1')
    expect(plannerStore.getState().scheduleSync.s1).toBeUndefined()

    resolveSave(new Response(JSON.stringify({ error: 'gone' }), { status: 404 }))
    await Promise.resolve()
    expect(plannerStore.getState().scheduleSync.s1).toBeUndefined()
    expect(plannerStore.getState().schedules.map(schedule => schedule.id)).toEqual(['s2'])
  })

  it('cancels queued authenticated saves on sign-out', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')
    plannerStore.setState({
      authed: true,
      termId: 'FA26',
      schedules: [{ id: 's1', termId: 'FA26', name: 'Sched', sectionIds: ['A'] }],
      activeScheduleId: 's1'
    })

    plannerStore.getState().removeSection('A')
    plannerStore.getState().setAuthed(false)
    await vi.advanceTimersByTimeAsync(800)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(plannerStore.getState().scheduleSync).toEqual({})
  })

  it('createSchedule sets lastError on API failure and clears on success', async () => {
    vi.resetModules()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Conflict' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schedules: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 's1', termId: 'FA26', name: 'New', items: [] }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const { plannerStore } = await import('./store')

    plannerStore.setState({ authed: true, termId: 'FA26', schedules: [], activeScheduleId: null, lastError: null })

    await plannerStore.getState().createSchedule('Test')
    expect(plannerStore.getState().lastError).toBe('Failed to create schedule')

    await plannerStore.getState().createSchedule('Test2')
    expect(plannerStore.getState().lastError).toBeNull()
  })

  it('clearError nullifies lastError', async () => {
    vi.resetModules()
    const { plannerStore } = await import('./store')

    plannerStore.setState({ lastError: 'Some error' })
    expect(plannerStore.getState().lastError).toBe('Some error')

    plannerStore.getState().clearError()
    expect(plannerStore.getState().lastError).toBeNull()
  })

  describe('shouldOfferImport', () => {
    it('false when guest data is null', async () => {
      vi.resetModules()
      const { shouldOfferImport } = await import('./store')
      expect(shouldOfferImport(null)).toBe(false)
    })

    it('false when guest has no schedules', async () => {
      vi.resetModules()
      const { shouldOfferImport } = await import('./store')
      expect(shouldOfferImport({ schedules: [] })).toBe(false)
    })

    it('true when guest only has schedules for a different term', async () => {
      vi.resetModules()
      const { shouldOfferImport } = await import('./store')
      const guest = { schedules: [{ id: 'guest-1', termId: 'WI26', name: 'Mine', sectionIds: [] }] }
      expect(shouldOfferImport(guest)).toBe(true)
    })

    it('true when the server already has schedules for the current term', async () => {
      vi.resetModules()
      const { shouldOfferImport } = await import('./store')
      const guest = { schedules: [{ id: 'guest-1', termId: 'FA26', name: 'Mine', sectionIds: [] }] }
      expect(shouldOfferImport(guest)).toBe(true)
    })

    it('true when guest has schedules for the term and the server has none', async () => {
      vi.resetModules()
      const { shouldOfferImport } = await import('./store')
      const guest = { schedules: [{ id: 'guest-1', termId: 'FA26', name: 'Mine', sectionIds: [] }] }
      expect(shouldOfferImport(guest)).toBe(true)
    })
  })

  describe('importGuestSchedules', () => {
    it('creates each guest schedule server-side, syncs items, clears guest storage, and refetches', async () => {
      vi.resetModules()
      saveLegacyGuest(
        [
          { id: 'guest-1', termId: 'FA26', name: 'Empty Plan', sectionIds: [] },
          { id: 'guest-2', termId: 'FA26', name: 'Full Plan', sectionIds: ['LE1'] }
        ],
        'guest-2'
      )

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/schedules' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string)
          const id = body.name === 'Empty Plan' ? 'srv-1' : 'srv-2'
          return new Response(JSON.stringify({ id, termId: 'FA26', name: body.name, items: [] }), { status: 201 })
        }
        if (url === '/api/schedules/srv-2/items' && init?.method === 'PUT') {
          return new Response(JSON.stringify({ id: 'srv-2', items: [{ sectionId: 'LE1', status: 'planned' }] }), { status: 200 })
        }
        if (url.startsWith('/api/schedules?term=')) {
          return new Response(
            JSON.stringify({
              schedules: [
                { id: 'srv-1', termId: 'FA26', name: 'Empty Plan', items: [] },
                { id: 'srv-2', termId: 'FA26', name: 'Full Plan', items: [{ sectionId: 'LE1', status: 'planned' }] }
              ]
            }),
            { status: 200 }
          )
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { plannerStore } = await import('./store')
      plannerStore.setState({ termId: 'FA26', authed: true })

      await plannerStore.getState().importGuestSchedules()

      expect(guestStorage.load()).toBeNull()
      expect(plannerStore.getState().schedules).toEqual([
        { id: 'srv-1', termId: 'FA26', name: 'Empty Plan', sectionIds: [] },
        { id: 'srv-2', termId: 'FA26', name: 'Full Plan', sectionIds: ['LE1'] }
      ])
    })

    it('on partial failure, keeps the failed schedule in guest storage but drops the succeeded one', async () => {
      vi.resetModules()
      saveLegacyGuest(
        [
          { id: 'guest-1', termId: 'FA26', name: 'Good Plan', sectionIds: [] },
          { id: 'guest-2', termId: 'FA26', name: 'Bad Plan', sectionIds: ['LE1'] }
        ],
        'guest-1'
      )

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/schedules' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string)
          if (body.name === 'Good Plan') {
            return new Response(JSON.stringify({ id: 'srv-1', termId: 'FA26', name: body.name, items: [] }), { status: 201 })
          }
          return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 })
        }
        if (url.startsWith('/api/schedules?term=')) {
          return new Response(JSON.stringify({ schedules: [{ id: 'srv-1', termId: 'FA26', name: 'Good Plan', items: [] }] }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { plannerStore } = await import('./store')
      plannerStore.setState({ termId: 'FA26', authed: true })

      await plannerStore.getState().importGuestSchedules()

      expect(plannerStore.getState().lastError).toBe('Some schedules could not be imported')
      expect(guestStorage.load()?.terms).toEqual({
        FA26: {
          schedules: [{ id: 'guest-2', name: 'Bad Plan', sectionIds: ['LE1'] }],
          activeScheduleId: 'guest-2'
        }
      })
    })

    it('is a no-op when not authed: no api calls, guest storage untouched', async () => {
      vi.resetModules()
      saveLegacyGuest(
        [{ id: 'guest-1', termId: 'FA26', name: 'Mine', sectionIds: [] }],
        'guest-1'
      )
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      const { plannerStore } = await import('./store')
      plannerStore.setState({ termId: 'FA26', authed: false })

      await plannerStore.getState().importGuestSchedules()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(guestStorage.load()?.terms).toEqual({
        FA26: {
          schedules: [{ id: 'guest-1', name: 'Mine', sectionIds: [] }],
          activeScheduleId: 'guest-1'
        }
      })
    })

    it('imports every guest term in one confirmation and refetches only the selected term', async () => {
      vi.resetModules()
      saveLegacyGuest(
        [
          { id: 'guest-1', termId: 'FA26', name: 'Fall Plan', sectionIds: [] },
          { id: 'guest-2', termId: 'WI26', name: 'Winter Plan', sectionIds: ['LE1'] }
        ],
        'guest-1'
      )

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/schedules' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string)
          const id = body.termId === 'FA26' ? 'srv-fa' : 'srv-wi'
          return new Response(JSON.stringify({ id, termId: body.termId, name: body.name, items: [] }), { status: 201 })
        }
        if (url === '/api/schedules/srv-wi/items' && init?.method === 'PUT') {
          return new Response(JSON.stringify({ id: 'srv-wi', items: [{ sectionId: 'LE1', status: 'planned' }] }), { status: 200 })
        }
        if (url === '/api/schedules?term=FA26') {
          return new Response(JSON.stringify({ schedules: [{ id: 'srv-fa', termId: 'FA26', name: 'Fall Plan', items: [] }] }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { plannerStore } = await import('./store')
      plannerStore.setState({ termId: 'FA26', authed: true })

      await plannerStore.getState().importGuestSchedules()

      expect(guestStorage.load()).toBeNull()
      expect(fetchMock).toHaveBeenCalledWith('/api/schedules', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ termId: 'WI26', name: 'Winter Plan' })
      }))
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/schedules?term=WI26')).toBe(false)
      expect(plannerStore.getState().schedules).toEqual([
        { id: 'srv-fa', termId: 'FA26', name: 'Fall Plan', sectionIds: [] }
      ])
    })

    it('retains failures and valid active IDs independently across imported terms', async () => {
      vi.resetModules()
      guestStorage.save({
        version: 2,
        terms: {
          FA26: {
            schedules: [
              { id: 'fa-good', name: 'Fall good', sectionIds: [] },
              { id: 'fa-bad', name: 'Fall bad', sectionIds: [] }
            ],
            activeScheduleId: 'fa-good'
          },
          WI27: {
            schedules: [
              { id: 'wi-bad-1', name: 'Winter bad 1', sectionIds: [] },
              { id: 'wi-bad-2', name: 'Winter bad 2', sectionIds: [] }
            ],
            activeScheduleId: 'wi-bad-2'
          }
        }
      })
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/schedules' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string)
          if (body.name === 'Fall good') {
            return new Response(JSON.stringify({ id: 'srv-fa', termId: 'FA26', name: body.name, items: [] }), { status: 201 })
          }
          return new Response(JSON.stringify({ error: 'failed' }), { status: 500 })
        }
        if (url === '/api/schedules?term=FA26') {
          return new Response(JSON.stringify({ schedules: [
            { id: 'srv-fa', termId: 'FA26', name: 'Fall good', items: [] }
          ] }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)
      const { plannerStore } = await import('./store')
      plannerStore.setState({ termId: 'FA26', authed: true })

      await plannerStore.getState().importGuestSchedules()

      expect(guestStorage.load()?.terms).toEqual({
        FA26: {
          schedules: [{ id: 'fa-bad', name: 'Fall bad', sectionIds: [] }],
          activeScheduleId: 'fa-bad'
        },
        WI27: {
          schedules: [
            { id: 'wi-bad-1', name: 'Winter bad 1', sectionIds: [] },
            { id: 'wi-bad-2', name: 'Winter bad 2', sectionIds: [] }
          ],
          activeScheduleId: 'wi-bad-2'
        }
      })
      expect(plannerStore.getState().activeScheduleId).toBe('srv-fa')
      expect(plannerStore.getState().lastError).toBe('Some schedules could not be imported')
    })

    it('remaps activeScheduleId from the guest id to the new server id when the active guest schedule imports', async () => {
      vi.resetModules()
      saveLegacyGuest(
        [{ id: 'guest-1', termId: 'FA26', name: 'Mine', sectionIds: [] }],
        'guest-1'
      )

      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/schedules' && init?.method === 'POST') {
          return new Response(JSON.stringify({ id: 'srv-1', termId: 'FA26', name: 'Mine', items: [] }), { status: 201 })
        }
        if (url.startsWith('/api/schedules?term=')) {
          return new Response(JSON.stringify({ schedules: [{ id: 'srv-1', termId: 'FA26', name: 'Mine', items: [] }] }), { status: 200 })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const { plannerStore } = await import('./store')
      plannerStore.setState({ termId: 'FA26', authed: true, activeScheduleId: 'guest-1' })

      await plannerStore.getState().importGuestSchedules()

      expect(plannerStore.getState().activeScheduleId).toBe('srv-1')
    })
  })
})
