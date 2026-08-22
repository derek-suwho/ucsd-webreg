import { z } from 'zod'

const STORAGE_KEY = 'webreg-guest-v2'
const LEGACY_STORAGE_KEY = 'webreg-guest-v1'
const MAX_STORAGE_BYTES = 65_536
const MAX_GUEST_TERMS = 16
const MAX_GUEST_SCHEDULES_PER_TERM = 20
const MAX_TOTAL_GUEST_SCHEDULES = 64
const MAX_SCHEDULE_ITEMS = 40
const MAX_IDENTIFIER_LENGTH = 128

export type GuestTermSchedule = {
  id: string
  name: string
  sectionIds: string[]
}

export type GuestTermData = {
  schedules: GuestTermSchedule[]
  activeScheduleId: string | null
}

export type GuestStorageData = {
  version: 2
  terms: Record<string, GuestTermData>
}

export type GuestSchedule = GuestTermSchedule & { termId: string }

/** Validated storage data plus a flattened read-only compatibility view used by UI callers. */
export type GuestData = GuestStorageData & { schedules: GuestSchedule[] }

const identifierSchema = z.string().min(1).max(MAX_IDENTIFIER_LENGTH)
const termIdSchema = z.string().min(1).max(16)
const termScheduleSchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(60),
  sectionIds: z.array(identifierSchema).max(MAX_SCHEDULE_ITEMS).refine(ids => new Set(ids).size === ids.length)
}).strict()
const termDataSchema = z.object({
  schedules: z.array(termScheduleSchema).max(MAX_GUEST_SCHEDULES_PER_TERM),
  activeScheduleId: identifierSchema.nullable()
}).strict().superRefine((term, context) => {
  const ids = term.schedules.map(schedule => schedule.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate schedule ID' })
  }
  if (term.activeScheduleId !== null && !ids.includes(term.activeScheduleId)) {
    context.addIssue({ code: 'custom', message: 'Active schedule is not in term' })
  }
})
const storageDataSchema = z.object({
  version: z.literal(2),
  terms: z.record(termIdSchema, termDataSchema)
}).strict().superRefine((data, context) => {
  const termEntries = Object.entries(data.terms)
  if (termEntries.length > MAX_GUEST_TERMS) {
    context.addIssue({ code: 'custom', message: 'Too many terms' })
  }
  const schedules = termEntries.flatMap(([, term]) => term.schedules)
  if (schedules.length > MAX_TOTAL_GUEST_SCHEDULES) {
    context.addIssue({ code: 'custom', message: 'Too many schedules' })
  }
  const ids = schedules.map(schedule => schedule.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate schedule ID across terms' })
  }
})

const legacyScheduleSchema = termScheduleSchema.extend({ termId: termIdSchema }).strict()
const legacyDataSchema = z.object({
  schedules: z.array(legacyScheduleSchema).max(MAX_TOTAL_GUEST_SCHEDULES),
  activeScheduleId: identifierSchema.nullable()
}).strict().superRefine((data, context) => {
  const ids = data.schedules.map(schedule => schedule.id)
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate schedule ID' })
  }
  if (new Set(data.schedules.map(schedule => schedule.termId)).size > MAX_GUEST_TERMS) {
    context.addIssue({ code: 'custom', message: 'Too many terms' })
  }
})

function isBounded(raw: string): boolean {
  return new TextEncoder().encode(raw).byteLength <= MAX_STORAGE_BYTES
}

function parseJson(raw: string): unknown | null {
  if (!isBounded(raw)) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function withSchedules(data: GuestStorageData): GuestData {
  return {
    ...data,
    schedules: Object.entries(data.terms).flatMap(([termId, term]) =>
      term.schedules.map(schedule => ({ ...schedule, termId }))
    )
  }
}

function migrateLegacy(raw: string): GuestStorageData | null {
  const parsed = parseJson(raw)
  if (parsed === null) return null
  const result = legacyDataSchema.safeParse(parsed)
  if (!result.success) return null

  const terms: Record<string, GuestTermData> = {}
  for (const schedule of result.data.schedules) {
    const term = terms[schedule.termId] ?? { schedules: [], activeScheduleId: null }
    term.schedules.push({ id: schedule.id, name: schedule.name, sectionIds: schedule.sectionIds })
    terms[schedule.termId] = term
  }
  for (const term of Object.values(terms)) {
    term.activeScheduleId = term.schedules.some(schedule => schedule.id === result.data.activeScheduleId)
      ? result.data.activeScheduleId
      : (term.schedules[0]?.id ?? null)
  }
  const migrated = storageDataSchema.safeParse({ version: 2, terms })
  return migrated.success ? migrated.data : null
}

function write(data: GuestStorageData): boolean {
  const result = storageDataSchema.safeParse(data)
  if (!result.success || typeof window === 'undefined') return false
  try {
    const raw = JSON.stringify(result.data)
    if (!isBounded(raw)) return false
    window.localStorage.setItem(STORAGE_KEY, raw)
    return true
  } catch {
    return false
  }
}

export function load(): GuestData | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== null) {
      const parsed = parseJson(raw)
      if (parsed === null) return null
      const result = storageDataSchema.safeParse(parsed)
      return result.success ? withSchedules(result.data) : null
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacyRaw === null) return null
    const migrated = migrateLegacy(legacyRaw)
    if (!migrated) return null
    if (write(migrated)) {
      try {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      } catch {
        // The v2 copy is authoritative; stale v1 can be removed later.
      }
    }
    return withSchedules(migrated)
  } catch {
    return null
  }
}

export function save(data: GuestStorageData): void {
  if (write(data)) {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      // The v2 write succeeded; a stale v1 value is harmless and can be removed later.
    }
  }
}

export function hasSchedulesForTerm(termId: string): boolean {
  return (load()?.terms[termId]?.schedules.length ?? 0) > 0
}

/** Read-modify-write one term while preserving every other validated term verbatim. */
export function saveTerm(termId: string, term: GuestTermData): void {
  const validatedTermId = termIdSchema.safeParse(termId)
  const validatedTerm = termDataSchema.safeParse(term)
  if (!validatedTermId.success || !validatedTerm.success) return
  const current = load()
  if (!current && typeof window !== 'undefined') {
    try {
      // Never replace unreadable stored data: it may contain other terms we cannot preserve.
      if (
        window.localStorage.getItem(STORAGE_KEY) !== null ||
        window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null
      ) return
    } catch {
      return
    }
  }
  const terms = current ? { ...current.terms } : {}
  if (validatedTerm.data.schedules.length === 0) delete terms[validatedTermId.data]
  else terms[validatedTermId.data] = validatedTerm.data
  if (Object.keys(terms).length === 0) {
    clear()
    return
  }
  save({ version: 2, terms })
}

export function clear(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Local persistence is best-effort for guests.
  }
}
