import { createStore } from 'zustand/vanilla'
import type { CatalogData } from '@webreg/catalog'
import { buildIndex, type SearchIndex } from '@webreg/search'
import { planSelection, swapWithinFamily, familySections } from '@webreg/planner'
import * as api from './api-client'
import * as guestStorage from './guest-storage'

const DEBOUNCE_MS = 800
const MAX_SCHEDULES_PER_TERM = 20
const MAX_SCHEDULE_ITEMS = 40
const MAX_IDENTIFIER_LENGTH = 128

export type PlannerSchedule = { id: string; termId: string; name: string; sectionIds: string[] }
export type ScheduleSyncStatus = 'saved' | 'pending' | 'failed'
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type PlannerState = {
  termId: string | null
  terms: api.ApiTerm[]
  termsStatus: LoadStatus
  termsError: string | null
  catalog: CatalogData | null
  index: SearchIndex | null
  catalogStatus: LoadStatus
  catalogError: string | null
  schedules: PlannerSchedule[]
  activeScheduleId: string | null
  authed: boolean
  scheduleSync: Record<string, ScheduleSyncStatus>
  lastError: string | null

  loadTerms(): Promise<void>
  loadTerm(termId: string): Promise<void>
  setAuthed(authed: boolean): void
  addSelection(courseId: string, family: string, chosen: string): void
  removeSection(id: string): void
  swapSection(fromId: string, toId: string): void
  createSchedule(name: string): Promise<void>
  renameSchedule(id: string, name: string): Promise<void>
  copySchedule(id: string, name: string): Promise<void>
  deleteSchedule(id: string): Promise<void>
  setActive(id: string): void
  clearError(): void
  refetchSchedules(): Promise<void>
  retryScheduleSave(id: string): Promise<void>
  flushPendingSaves(): Promise<void>
  importGuestSchedules(): Promise<void>
}

/** One confirmation imports every remaining local term, independent of current server schedules. */
export function shouldOfferImport(guest: { schedules: guestStorage.GuestSchedule[] } | null): boolean {
  return !!guest && guest.schedules.length > 0
}

let guestIdCounter = 0
function nextGuestId(): string {
  guestIdCounter += 1
  return `guest-${guestIdCounter}`
}

function nextUniqueGuestId(schedules: PlannerSchedule[]): string {
  const ids = new Set(schedules.map(schedule => schedule.id))
  let id = nextGuestId()
  while (ids.has(id)) id = nextGuestId()
  return id
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_IDENTIFIER_LENGTH
}

function mapApiSchedule(schedule: api.ApiSchedule, expectedTermId: string): PlannerSchedule | null {
  if (
    !schedule || typeof schedule !== 'object' ||
    !boundedIdentifier(schedule.id) ||
    schedule.termId !== expectedTermId ||
    typeof schedule.name !== 'string' ||
    schedule.name.trim().length === 0 ||
    schedule.name.length > 60 ||
    !Array.isArray(schedule.items) ||
    schedule.items.length > MAX_SCHEDULE_ITEMS
  ) return null

  const sectionIds = schedule.items.map(item => item?.sectionId)
  if (!sectionIds.every(boundedIdentifier) || new Set(sectionIds).size !== sectionIds.length) return null
  return { id: schedule.id, termId: schedule.termId, name: schedule.name, sectionIds }
}

function mapApiSchedules(schedules: api.ApiSchedule[], expectedTermId: string): PlannerSchedule[] {
  if (!Array.isArray(schedules) || schedules.length > MAX_SCHEDULES_PER_TERM) {
    throw new api.ApiError(502, 'Invalid schedule response')
  }
  const candidates = schedules.map(schedule => mapApiSchedule(schedule, expectedTermId))
  if (candidates.some(schedule => schedule === null)) {
    throw new api.ApiError(502, 'Invalid schedule response')
  }
  const mapped = candidates as PlannerSchedule[]
  if (new Set(mapped.map(schedule => schedule.id)).size !== mapped.length) {
    throw new api.ApiError(502, 'Invalid schedule response')
  }
  return mapped
}

function hydrateGuestCounter(): void {
  if (typeof window === 'undefined') return

  const data = guestStorage.load()
  if (!data) return

  for (const schedule of data.schedules) {
    const match = /^guest-(\d+)$/.exec(schedule.id)
    if (match) guestIdCounter = Math.max(guestIdCounter, parseInt(match[1], 10))
  }
}

function guestStateForTerm(termId: string): { schedules: PlannerSchedule[]; activeScheduleId: string | null } {
  const data = guestStorage.load()
  if (!data) return { schedules: [], activeScheduleId: null }

  const term = data.terms[termId]
  if (!term) return { schedules: [], activeScheduleId: null }
  const schedules = term.schedules.map(schedule => ({ ...schedule, termId }))
  const activeScheduleId = schedules.some(schedule => schedule.id === term.activeScheduleId)
    ? term.activeScheduleId
    : (schedules[0]?.id ?? null)

  return { schedules, activeScheduleId }
}

hydrateGuestCounter()

type ItemSaveQueue = {
  revision: number
  sectionIds: string[]
  timer: ReturnType<typeof setTimeout> | null
  ready: boolean
  inFlight: { revision: number; promise: Promise<void> } | null
  session: number
}

type ItemMutation = {
  revision: number
  sectionIds: string[]
  acknowledged: boolean
  session: number
}

const itemSaveQueues = new Map<string, ItemSaveQueue>()
const latestItemMutations = new Map<string, ItemMutation>()
let itemSaveRevision = 0
let saveSession = 0
let catalogLoadGeneration = 0
let activeCatalogController: AbortController | null = null
let termsLoadGeneration = 0
let scheduleLoadGeneration = 0
const scheduleFetches = new Map<string, Promise<void>>()
const scheduleFetchOutcomes = new Map<string, 'pending' | 'succeeded' | 'failed'>()
const defaultScheduleCreations = new Map<string, Promise<void>>()
const renameTokens = new Map<string, symbol>()

export const plannerStore = createStore<PlannerState>()((set, get) => {
  function setSyncStatus(scheduleId: string, status: ScheduleSyncStatus, session = saveSession) {
    if (session !== saveSession || !get().authed) return
    set(state => ({ scheduleSync: { ...state.scheduleSync, [scheduleId]: status } }))
  }

  function invalidateScheduleSave(scheduleId: string) {
    const queue = itemSaveQueues.get(scheduleId)
    if (queue?.timer) clearTimeout(queue.timer)
    itemSaveQueues.delete(scheduleId)
    latestItemMutations.delete(scheduleId)
    set(state => {
      if (!(scheduleId in state.scheduleSync)) return state
      const scheduleSync = { ...state.scheduleSync }
      delete scheduleSync[scheduleId]
      return { scheduleSync }
    })
  }

  function invalidateAllScheduleSaves() {
    saveSession += 1
    for (const queue of itemSaveQueues.values()) {
      if (queue.timer) clearTimeout(queue.timer)
    }
    itemSaveQueues.clear()
    latestItemMutations.clear()
  }

  async function drainScheduleSave(scheduleId: string): Promise<void> {
    let queue = itemSaveQueues.get(scheduleId)
    if (!queue || queue.session !== saveSession || !get().authed) return

    if (queue.inFlight) {
      await queue.inFlight.promise
      queue = itemSaveQueues.get(scheduleId)
      if (queue?.session === saveSession && queue.ready && !queue.inFlight) {
        await drainScheduleSave(scheduleId)
      }
      return
    }
    if (!queue.ready) return

    const revision = queue.revision
    const session = queue.session
    const sectionIds = [...queue.sectionIds]
    queue.ready = false

    const promise = (async () => {
      let saved = false
      try {
        await api.putScheduleItems(scheduleId, sectionIds, { keepalive: true })
        saved = true
      } catch {
        // The queue and latest payload remain available for explicit retry.
      }

      const current = itemSaveQueues.get(scheduleId)
      if (
        !current ||
        current.session !== session ||
        current.inFlight?.revision !== revision ||
        session !== saveSession
      ) return

      current.inFlight = null
      if (current.revision !== revision) {
        setSyncStatus(scheduleId, 'pending', session)
        return
      }
      if (saved) {
        const mutation = latestItemMutations.get(scheduleId)
        if (mutation?.session === session && mutation.revision === revision) {
          mutation.acknowledged = true
        }
        itemSaveQueues.delete(scheduleId)
        setSyncStatus(scheduleId, 'saved', session)
      } else {
        setSyncStatus(scheduleId, 'failed', session)
      }
    })()

    queue.inFlight = { revision, promise }
    await promise

    queue = itemSaveQueues.get(scheduleId)
    if (queue?.session === saveSession && queue.ready && !queue.inFlight) {
      await drainScheduleSave(scheduleId)
    }
  }

  function persistGuest() {
    const state = get()
    if (!state.termId) return
    const schedules = state.schedules.filter(schedule => schedule.termId === state.termId)
    guestStorage.saveTerm(state.termId, {
      schedules: schedules.map(schedule => ({
        id: schedule.id,
        name: schedule.name,
        sectionIds: schedule.sectionIds
      })),
      activeScheduleId: state.activeScheduleId
    })
  }

  function persistItems(scheduleId: string, sectionIds: string[]) {
    if (!get().authed) {
      persistGuest()
      return
    }

    const revision = ++itemSaveRevision
    const existing = itemSaveQueues.get(scheduleId)
    if (existing?.timer) clearTimeout(existing.timer)
    const queue: ItemSaveQueue = existing?.session === saveSession
      ? existing
      : { revision, sectionIds: [], timer: null, ready: false, inFlight: null, session: saveSession }
    queue.revision = revision
    queue.sectionIds = [...sectionIds]
    queue.ready = false
    queue.session = saveSession
    queue.timer = setTimeout(() => {
      const current = itemSaveQueues.get(scheduleId)
      if (current !== queue || current.session !== saveSession) return
      current.timer = null
      current.ready = true
      void drainScheduleSave(scheduleId)
    }, DEBOUNCE_MS)
    itemSaveQueues.set(scheduleId, queue)
    latestItemMutations.set(scheduleId, {
      revision,
      sectionIds: [...sectionIds],
      acknowledged: false,
      session: saveSession
    })
    setSyncStatus(scheduleId, 'pending')
  }

  function updateActiveSectionIds(nextSectionIds: string[]) {
    const { activeScheduleId } = get()
    if (!activeScheduleId) return
    if (
      nextSectionIds.length > MAX_SCHEDULE_ITEMS ||
      !nextSectionIds.every(boundedIdentifier) ||
      new Set(nextSectionIds).size !== nextSectionIds.length
    ) {
      set({ lastError: 'Invalid schedule selection' })
      return
    }
    set(state => ({
      schedules: state.schedules.map(s => (s.id === activeScheduleId ? { ...s, sectionIds: nextSectionIds } : s))
    }))
    persistItems(activeScheduleId, nextSectionIds)
  }

  function refetchSchedules(): Promise<void> {
    const { termId } = get()
    if (!termId) return Promise.resolve()
    scheduleLoadGeneration += 1
    const generation = scheduleLoadGeneration
    const requestStartRevision = itemSaveRevision
    const acknowledgedAtStart = new Map<string, number>()
    for (const [scheduleId, mutation] of latestItemMutations) {
      if (mutation.session === saveSession && mutation.acknowledged) {
        acknowledgedAtStart.set(scheduleId, mutation.revision)
      }
    }
    scheduleFetchOutcomes.set(termId, 'pending')
    const request = (async () => {
      try {
        const { schedules } = await api.listSchedules(termId)
        if (generation !== scheduleLoadGeneration || get().termId !== termId) return
        const mapped = mapApiSchedules(schedules, termId).map(schedule => {
          const mutation = latestItemMutations.get(schedule.id)
          if (!mutation || mutation.session !== saveSession) return schedule
          const safeToRetire =
            mutation.revision <= requestStartRevision &&
            acknowledgedAtStart.get(schedule.id) === mutation.revision
          if (safeToRetire) return schedule
          return { ...schedule, sectionIds: [...mutation.sectionIds] }
        })
        const activeScheduleId = mapped.some(schedule => schedule.id === get().activeScheduleId)
          ? get().activeScheduleId
          : (mapped[0]?.id ?? null)
        set(state => {
          const scheduleSync = { ...state.scheduleSync }
          for (const schedule of mapped) scheduleSync[schedule.id] ??= 'saved'
          return { schedules: mapped, activeScheduleId, scheduleSync }
        })
        for (const [scheduleId, revision] of acknowledgedAtStart) {
          const mutation = latestItemMutations.get(scheduleId)
          if (
            mutation?.session === saveSession &&
            mutation.revision === revision &&
            revision <= requestStartRevision
          ) latestItemMutations.delete(scheduleId)
        }
        scheduleFetchOutcomes.set(termId, 'succeeded')
      } catch {
        if (generation === scheduleLoadGeneration && get().termId === termId) {
          scheduleFetchOutcomes.set(termId, 'failed')
        }
        // Resync failed; leave local state as the best available truth.
      }
    })()
    scheduleFetches.set(termId, request)
    void request.finally(() => {
      if (scheduleFetches.get(termId) === request) scheduleFetches.delete(termId)
    })
    return request
  }

  return {
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
    lastError: null,

    async loadTerms() {
      const generation = ++termsLoadGeneration
      set({ termsStatus: 'loading', termsError: null })
      try {
        const { terms } = await api.listTerms()
        if (generation !== termsLoadGeneration) return

        const retainedId = get().termId
        const selected = terms.find(term => term.id === retainedId)
          ?? terms.find(term => term.active)
          ?? terms[0]
          ?? null
        set({ terms, termsStatus: 'ready', termsError: null })

        if (!selected) {
          catalogLoadGeneration += 1
          scheduleLoadGeneration += 1
          activeCatalogController?.abort()
          activeCatalogController = null
          renameTokens.clear()
          scheduleFetches.clear()
          set({
            termId: null,
            catalog: null,
            index: null,
            catalogStatus: 'idle',
            catalogError: null,
            schedules: [],
            activeScheduleId: null
          })
          return
        }

        await get().loadTerm(selected.id)
      } catch {
        if (generation !== termsLoadGeneration) return
        set({ termsStatus: 'error', termsError: 'Could not load terms. Try again.' })
      }
    },

    async loadTerm(termId) {
      catalogLoadGeneration += 1
      const generation = catalogLoadGeneration
      scheduleLoadGeneration += 1
      renameTokens.clear()
      scheduleFetchOutcomes.delete(termId)
      activeCatalogController?.abort()
      const controller = new AbortController()
      activeCatalogController = controller

      const authed = get().authed
      const guestState = !authed ? guestStateForTerm(termId) : { schedules: [], activeScheduleId: null }
      set({
        termId,
        catalog: null,
        index: null,
        catalogStatus: 'loading',
        catalogError: null,
        ...guestState
      })

      const schedulesRequest = authed ? refetchSchedules() : Promise.resolve()

      try {
        const catalog = await api.fetchCatalog(termId, { signal: controller.signal })
        if (generation !== catalogLoadGeneration) return
        set({ catalog, index: buildIndex(catalog), catalogStatus: 'ready', catalogError: null })
      } catch {
        if (generation !== catalogLoadGeneration) return
        set({ catalogStatus: 'error', catalogError: 'Could not load catalog. Try again.' })
      } finally {
        if (generation === catalogLoadGeneration) activeCatalogController = null
      }
      await schedulesRequest
    },

    setAuthed(authed) {
      const wasAuthed = get().authed
      if (!authed && wasAuthed) {
        invalidateAllScheduleSaves()
        scheduleLoadGeneration += 1
        scheduleFetches.clear()
        renameTokens.clear()
        const termId = get().termId
        if (termId) scheduleFetchOutcomes.delete(termId)
        set({
          authed,
          scheduleSync: {},
          ...(termId ? guestStateForTerm(termId) : { schedules: [], activeScheduleId: null })
        })
        return
      }
      if (authed && !wasAuthed) invalidateAllScheduleSaves()
      set({ authed })
      // Freshly authed: the schedule list currently in state may still be guest-hydrated
      // (from localStorage), not server truth — replace it. No-op if termId isn't loaded yet;
      // the page effect re-triggers this once loadTerm resolves.
      if (authed && !wasAuthed) {
        if (get().termId) scheduleFetchOutcomes.delete(get().termId!)
        void refetchSchedules()
      }
    },

    addSelection(courseId, family, chosen) {
      const { catalog, schedules, activeScheduleId } = get()
      if (!catalog || !activeScheduleId) return
      const schedule = schedules.find(s => s.id === activeScheduleId)
      if (!schedule) return

      const chosenIds = planSelection(catalog, courseId, family, chosen)
      const familyIds = new Set(familySections(catalog, courseId, family).map(s => s.id))
      const kept = schedule.sectionIds.filter(id => !familyIds.has(id))
      updateActiveSectionIds([...kept, ...chosenIds])
    },

    removeSection(id) {
      const { schedules, activeScheduleId } = get()
      const schedule = schedules.find(s => s.id === activeScheduleId)
      if (!schedule) return
      updateActiveSectionIds(schedule.sectionIds.filter(sid => sid !== id))
    },

    swapSection(fromId, toId) {
      const { schedules, activeScheduleId } = get()
      const schedule = schedules.find(s => s.id === activeScheduleId)
      if (!schedule) return
      updateActiveSectionIds(swapWithinFamily(schedule.sectionIds, fromId, toId))
    },

    async createSchedule(name) {
      const { termId, authed, schedules } = get()
      if (!termId) return
      if (typeof name !== 'string' || name.length === 0 || name.length > 60) {
        set({ lastError: 'Invalid schedule name' })
        return
      }
      if (schedules.filter(schedule => schedule.termId === termId).length >= MAX_SCHEDULES_PER_TERM) {
        set({ lastError: 'Schedule limit reached' })
        return
      }

      if (!authed) {
        const id = nextUniqueGuestId(schedules)
        set(state => ({
          schedules: [...state.schedules, { id, termId, name, sectionIds: [] }],
          activeScheduleId: state.activeScheduleId ?? id,
          lastError: null
        }))
        persistGuest()
        return
      }

      const createAuthenticated = async () => {
        // Home can request its default while the initial account fetch is pending.
        // Wait for server truth so an existing account schedule is never duplicated.
        if (name === 'My Schedule') {
          let pendingFetch = scheduleFetches.get(termId)
          while (pendingFetch) {
            await pendingFetch
            pendingFetch = scheduleFetches.get(termId)
          }
          if (get().termId !== termId || get().schedules.some(schedule => schedule.termId === termId)) return
          if (scheduleFetchOutcomes.get(termId) !== 'succeeded') {
            set({ lastError: 'Could not load schedules' })
            return
          }
        }

        try {
          const created = await api.createSchedule(termId, name)
          const mapped = mapApiSchedule(created, termId)
          if (!mapped) throw new api.ApiError(502, 'Invalid schedule response')
          if (get().termId !== termId) return
          set(state => {
            const schedules = state.schedules.some(schedule => schedule.id === mapped.id)
              ? state.schedules
              : [...state.schedules, mapped]
            const activeScheduleId = schedules.some(schedule => schedule.id === state.activeScheduleId)
              ? state.activeScheduleId
              : mapped.id
            return {
              schedules,
              activeScheduleId,
              scheduleSync: { ...state.scheduleSync, [mapped.id]: 'saved' as const },
              lastError: null
            }
          })
        } catch (err) {
          if (!(err instanceof api.ApiError)) throw err
          if (get().termId === termId) {
            set({ lastError: 'Failed to create schedule' })
            await refetchSchedules()
          }
        }
      }

      if (name !== 'My Schedule') {
        await createAuthenticated()
        return
      }

      const existingCreation = defaultScheduleCreations.get(termId)
      if (existingCreation) {
        await existingCreation
        return
      }
      const creation = createAuthenticated()
      defaultScheduleCreations.set(termId, creation)
      try {
        await creation
      } finally {
        if (defaultScheduleCreations.get(termId) === creation) defaultScheduleCreations.delete(termId)
      }
    },

    async renameSchedule(id, name) {
      const { authed, schedules, termId } = get()
      if (typeof name !== 'string' || name.length === 0 || name.length > 60) {
        set({ lastError: 'Invalid schedule name' })
        return
      }
      const current = schedules.find(schedule => schedule.id === id && schedule.termId === termId)
      if (!current) return
      const prevName = current.name
      set(state => ({ schedules: state.schedules.map(s => (s.id === id ? { ...s, name } : s)), lastError: null }))

      if (!authed) {
        persistGuest()
        return
      }
      const token = Symbol(id)
      renameTokens.set(id, token)
      const isCurrentRename = () =>
        renameTokens.get(id) === token &&
        get().authed &&
        get().termId === termId &&
        get().schedules.some(schedule => schedule.id === id && schedule.termId === termId)
      try {
        const updated = await api.renameSchedule(id, name)
        if (!isCurrentRename()) return
        const mapped = termId ? mapApiSchedule(updated, termId) : null
        if (!mapped || mapped.id !== id) throw new api.ApiError(502, 'Invalid schedule response')
        set(state => ({
          schedules: state.schedules.map(schedule => schedule.id === id
            ? { ...mapped, sectionIds: [...schedule.sectionIds] }
            : schedule),
          lastError: null
        }))
      } catch (err) {
        if (!isCurrentRename()) return
        if (!(err instanceof api.ApiError)) throw err
        if (prevName !== undefined) {
          set(state => ({ schedules: state.schedules.map(s => (s.id === id ? { ...s, name: prevName } : s)), lastError: 'Failed to rename schedule' }))
        } else {
          set({ lastError: 'Failed to rename schedule' })
        }
        await refetchSchedules()
      }
    },

    async copySchedule(id, name) {
      const { termId, authed, schedules } = get()
      if (!termId) return
      if (typeof name !== 'string' || name.length === 0 || name.length > 60) {
        set({ lastError: 'Invalid schedule name' })
        return
      }
      const source = schedules.find(schedule => schedule.id === id && schedule.termId === termId)
      if (!source) return

      if (!authed) {
        if (schedules.filter(schedule => schedule.termId === termId).length >= MAX_SCHEDULES_PER_TERM) {
          set({ lastError: 'Schedule limit reached' })
          return
        }
        const newId = nextUniqueGuestId(schedules)
        set(state => ({ schedules: [...state.schedules, { id: newId, termId, name, sectionIds: [...source.sectionIds] }], lastError: null }))
        persistGuest()
        return
      }

      try {
        const created = await api.copySchedule(id, name)
        const mapped = mapApiSchedule(created, termId)
        if (!mapped) throw new api.ApiError(502, 'Invalid schedule response')
        if (get().termId !== termId) return
        set(state => ({
          schedules: [...state.schedules, mapped],
          scheduleSync: { ...state.scheduleSync, [mapped.id]: 'saved' },
          lastError: null
        }))
      } catch (err) {
        if (!(err instanceof api.ApiError)) throw err
        if (get().termId === termId) {
          set({ lastError: 'Failed to copy schedule' })
          await refetchSchedules()
        }
      }
    },

    async deleteSchedule(id) {
      const { authed, schedules, termId } = get()
      if (!termId) return
      const removedIndex = schedules.findIndex(schedule => schedule.id === id && schedule.termId === termId)
      if (removedIndex < 0) return

      const removeFromCurrentTerm = () => {
        const current = get()
        if (current.termId !== termId) return 0
        const remaining = current.schedules.filter(schedule => schedule.id !== id)
        const nextActive = current.activeScheduleId === id
          ? (remaining[Math.min(removedIndex, remaining.length - 1)]?.id ?? null)
          : current.activeScheduleId
        set({ schedules: remaining, activeScheduleId: nextActive })
        return remaining.length
      }

      if (!authed) {
        renameTokens.delete(id)
        const remaining = removeFromCurrentTerm()
        persistGuest()
        if (remaining === 0) await get().createSchedule('My Schedule')
        return
      }
      try {
        await api.deleteSchedule(id)
        renameTokens.delete(id)
        invalidateScheduleSave(id)
        if (get().termId !== termId) return
        const remaining = removeFromCurrentTerm()
        scheduleFetchOutcomes.set(termId, 'succeeded')
        set({ lastError: null })
        if (remaining === 0) await get().createSchedule('My Schedule')
      } catch (err) {
        if (!(err instanceof api.ApiError)) throw err
        if (get().termId === termId) {
          set({ lastError: 'Failed to delete schedule' })
        }
      }
    },

    setActive(id) {
      const { termId, schedules } = get()
      if (!termId || !schedules.some(schedule => schedule.id === id && schedule.termId === termId)) return
      set({ activeScheduleId: id })
      if (!get().authed) persistGuest()
    },

    clearError() {
      set({ lastError: null })
    },

    refetchSchedules,

    async retryScheduleSave(id) {
      const queue = itemSaveQueues.get(id)
      if (!get().authed || !queue || queue.session !== saveSession) return
      if (queue.timer) clearTimeout(queue.timer)
      queue.timer = null
      queue.ready = true
      setSyncStatus(id, 'pending', queue.session)
      await drainScheduleSave(id)
    },

    async flushPendingSaves() {
      if (!get().authed) return
      const pendingIds = [...itemSaveQueues.keys()].filter(id => get().scheduleSync[id] === 'pending')
      for (const id of pendingIds) {
        const queue = itemSaveQueues.get(id)
        if (!queue || queue.session !== saveSession) continue
        if (queue.timer) clearTimeout(queue.timer)
        queue.timer = null
        queue.ready = true
      }
      await Promise.all(pendingIds.map(id => drainScheduleSave(id)))
    },

    async importGuestSchedules() {
      const { termId, authed } = get()
      if (!termId || !authed) return
      const guest = guestStorage.load()
      if (!guest) return
      if (guest.schedules.length === 0) return

      let hadFailure = false
      const importedByTerm = new Map<string, Map<string, string>>()
      const remainingTerms: guestStorage.GuestStorageData['terms'] = {}

      for (const [guestTermId, guestTerm] of Object.entries(guest.terms)) {
        const failed = new Set<string>()
        const imported = new Map<string, string>()
        importedByTerm.set(guestTermId, imported)

        for (const schedule of guestTerm.schedules) {
          try {
            const created = await api.createSchedule(guestTermId, schedule.name)
            const mapped = mapApiSchedule(created, guestTermId)
            if (!mapped) throw new api.ApiError(502, 'Invalid schedule response')
            if (schedule.sectionIds.length > 0) {
              await api.putScheduleItems(created.id, schedule.sectionIds)
            }
            imported.set(schedule.id, created.id)
          } catch {
            failed.add(schedule.id)
            hadFailure = true
          }
        }

        const schedules = guestTerm.schedules.filter(schedule => failed.has(schedule.id))
        if (schedules.length > 0) {
          remainingTerms[guestTermId] = {
            schedules,
            activeScheduleId: schedules.some(schedule => schedule.id === guestTerm.activeScheduleId)
              ? guestTerm.activeScheduleId
              : schedules[0].id
          }
        }
      }

      if (Object.keys(remainingTerms).length > 0) guestStorage.save({ version: 2, terms: remainingTerms })
      else guestStorage.clear()
      set({ lastError: hadFailure ? 'Some schedules could not be imported' : null })

      await refetchSchedules()

      const selectedTermId = get().termId
      const selectedGuestTerm = selectedTermId ? guest.terms[selectedTermId] : undefined
      const importedActiveId = selectedGuestTerm?.activeScheduleId
        ? importedByTerm.get(selectedTermId!)?.get(selectedGuestTerm.activeScheduleId)
        : undefined
      if (
        importedActiveId &&
        selectedTermId !== null &&
        get().schedules.some(schedule => schedule.id === importedActiveId && schedule.termId === selectedTermId)
      ) {
        set({ activeScheduleId: importedActiveId })
      }
    }
  }
})
