// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clear, hasSchedulesForTerm, load, save, saveTerm, type GuestStorageData } from './guest-storage'

const TWO_TERMS: GuestStorageData = {
  version: 2,
  terms: {
    FA26: {
      schedules: [{ id: 'guest-1', name: 'Fall', sectionIds: ['A', 'B'] }],
      activeScheduleId: 'guest-1'
    },
    WI27: {
      schedules: [{ id: 'guest-2', name: 'Winter', sectionIds: ['C'] }],
      activeScheduleId: 'guest-2'
    }
  }
}

describe('guest-storage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when nothing is stored', () => {
    expect(load()).toBeNull()
  })

  it('round-trips a versioned term-keyed payload', () => {
    save(TWO_TERMS)

    expect(load()).toMatchObject(TWO_TERMS)
    expect(load()?.schedules).toEqual([
      { id: 'guest-1', termId: 'FA26', name: 'Fall', sectionIds: ['A', 'B'] },
      { id: 'guest-2', termId: 'WI27', name: 'Winter', sectionIds: ['C'] }
    ])
    expect(JSON.parse(window.localStorage.getItem('webreg-guest-v2')!)).toEqual(TWO_TERMS)
  })

  it('updates one term without rewriting or dropping another', () => {
    save(TWO_TERMS)

    saveTerm('FA26', {
      schedules: [{ id: 'guest-3', name: 'New Fall', sectionIds: [] }],
      activeScheduleId: 'guest-3'
    })

    expect(load()?.terms).toEqual({
      FA26: {
        schedules: [{ id: 'guest-3', name: 'New Fall', sectionIds: [] }],
        activeScheduleId: 'guest-3'
      },
      WI27: TWO_TERMS.terms.WI27
    })
  })

  it('checks guest data for one exact term', () => {
    save(TWO_TERMS)

    expect(hasSchedulesForTerm('FA26')).toBe(true)
    expect(hasSchedulesForTerm('SP27')).toBe(false)
  })

  it('migrates valid v1 flat data to v2 without changing term ownership', () => {
    window.localStorage.setItem('webreg-guest-v1', JSON.stringify({
      schedules: [
        { id: 'guest-1', termId: 'FA26', name: 'Fall', sectionIds: ['A'] },
        { id: 'guest-2', termId: 'WI27', name: 'Winter', sectionIds: ['B'] }
      ],
      activeScheduleId: 'guest-2'
    }))

    expect(load()?.terms).toEqual({
      FA26: {
        schedules: [{ id: 'guest-1', name: 'Fall', sectionIds: ['A'] }],
        activeScheduleId: 'guest-1'
      },
      WI27: {
        schedules: [{ id: 'guest-2', name: 'Winter', sectionIds: ['B'] }],
        activeScheduleId: 'guest-2'
      }
    })
    expect(window.localStorage.getItem('webreg-guest-v1')).toBeNull()
    expect(window.localStorage.getItem('webreg-guest-v2')).not.toBeNull()
  })

  it('does not delete v1 when v2 migration cannot be written', () => {
    window.localStorage.setItem('webreg-guest-v1', JSON.stringify({
      schedules: [{ id: 'guest-1', termId: 'FA26', name: 'Fall', sectionIds: [] }],
      activeScheduleId: 'guest-1'
    }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(load()?.terms.FA26?.activeScheduleId).toBe('guest-1')
    expect(window.localStorage.getItem('webreg-guest-v1')).not.toBeNull()
  })

  it('clear removes both storage versions', () => {
    save(TWO_TERMS)
    window.localStorage.setItem('webreg-guest-v1', '{}')
    clear()
    expect(load()).toBeNull()
    expect(window.localStorage.getItem('webreg-guest-v1')).toBeNull()
    expect(window.localStorage.getItem('webreg-guest-v2')).toBeNull()
  })

  it('guards against malformed JSON', () => {
    window.localStorage.setItem('webreg-guest-v2', '{not valid json')
    expect(load()).toBeNull()
  })

  it.each([
    [null],
    [{ version: 1, terms: {} }],
    [{ version: 2, terms: [] }],
    [{ version: 2, terms: { '': { schedules: [], activeScheduleId: null } } }],
    [{ version: 2, terms: { FA26: { schedules: [null], activeScheduleId: null } } }],
    [{ version: 2, terms: { FA26: { schedules: [{ id: '', name: 'Plan', sectionIds: [] }], activeScheduleId: null } } }],
    [{ version: 2, terms: { FA26: { schedules: [{ id: 'guest-1', name: 'Plan', sectionIds: 'LE1' }], activeScheduleId: null } } }],
    [{ version: 2, terms: { FA26: { schedules: [{ id: 'guest-1', name: 'Plan', sectionIds: [null] }], activeScheduleId: null } } }],
    [{ version: 2, terms: { FA26: { schedules: [], activeScheduleId: 'guest-1' } } }],
    [{ version: 2, terms: { FA26: { schedules: [{ id: 'guest-1', name: 'Plan', sectionIds: [] }], activeScheduleId: 'other' } } }]
  ])('rejects malformed nested data %#', value => {
    window.localStorage.setItem('webreg-guest-v2', JSON.stringify(value))
    expect(load()).toBeNull()
  })

  it('rejects duplicate schedule and section IDs', () => {
    window.localStorage.setItem('webreg-guest-v2', JSON.stringify({
      version: 2,
      terms: {
        FA26: {
          schedules: [{ id: 'guest-1', name: 'Fall', sectionIds: ['A', 'A'] }],
          activeScheduleId: 'guest-1'
        },
        WI27: {
          schedules: [{ id: 'guest-1', name: 'Winter', sectionIds: [] }],
          activeScheduleId: 'guest-1'
        }
      }
    }))
    expect(load()).toBeNull()
  })

  it('rejects excessive terms, schedules, items, and raw bytes', () => {
    const terms = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
      `T${index}`,
      { schedules: [], activeScheduleId: null }
    ]))
    for (const payload of [
      { version: 2, terms },
      {
        version: 2,
        terms: {
          FA26: {
            schedules: Array.from({ length: 21 }, (_, index) => ({ id: `g-${index}`, name: 'Plan', sectionIds: [] })),
            activeScheduleId: null
          }
        }
      },
      {
        version: 2,
        terms: {
          FA26: {
            schedules: [{ id: 'guest-1', name: 'Plan', sectionIds: Array.from({ length: 41 }, (_, index) => `S${index}`) }],
            activeScheduleId: 'guest-1'
          }
        }
      }
    ]) {
      window.localStorage.setItem('webreg-guest-v2', JSON.stringify(payload))
      expect(load()).toBeNull()
    }

    window.localStorage.setItem('webreg-guest-v2', ' '.repeat(65_537))
    expect(load()).toBeNull()
  })

  it('returns null when storage access is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError')
    })

    expect(load()).toBeNull()
  })

  it('does not throw when writes are unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })

    expect(() => save(TWO_TERMS)).not.toThrow()
    expect(() => saveTerm('FA26', TWO_TERMS.terms.FA26)).not.toThrow()
  })

  it('does not overwrite unreadable data while updating one term', () => {
    const malformed = '{broken'
    window.localStorage.setItem('webreg-guest-v2', malformed)

    saveTerm('FA26', TWO_TERMS.terms.FA26)

    expect(window.localStorage.getItem('webreg-guest-v2')).toBe(malformed)
  })

  it('does not silently rewrite bounded legacy-compatible strings', () => {
    window.localStorage.setItem('webreg-guest-v2', JSON.stringify({
      version: 2,
      terms: {
        ' FA26': {
          schedules: [{ id: 'guest-1', name: ' Plan', sectionIds: [] }],
          activeScheduleId: 'guest-1'
        }
      }
    }))

    expect(load()?.terms[' FA26']?.schedules[0]).toEqual({
      id: 'guest-1',
      name: ' Plan',
      sectionIds: []
    })
  })
})
