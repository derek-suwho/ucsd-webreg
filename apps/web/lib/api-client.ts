import type { CatalogData } from '@webreg/catalog'
import { z } from 'zod'

const MAX_CATALOG_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_TERMS_RESPONSE_BYTES = 256 * 1024
const MAX_API_RESPONSE_BYTES = 1024 * 1024
const MAX_ACCOUNT_EXPORT_RESPONSE_BYTES = 256 * 1024

const catalogProvenanceSchema = z.object({
  sourceKind: z.enum(['fixture', 'legacy-soc', 'tss']),
  mode: z.enum(['demo', 'live']),
  sourceGeneratedAt: z.string().datetime({ offset: true })
}).superRefine((provenance, ctx) => {
  if (provenance.sourceKind === 'fixture' && provenance.mode !== 'demo') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mode'],
      message: 'fixture provenance must use demo mode'
    })
  }
})

const apiTermSchema = z.object({
  id: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(256),
  active: z.boolean(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true })
})

const catalogMeetingSchema = z.object({
  type: z.string(),
  days: z.string().nullable(),
  start: z.number().nullable(),
  end: z.number().nullable(),
  bldg: z.string().nullable(),
  room: z.string().nullable()
})

const catalogExamSchema = z.object({
  type: z.string(),
  date: z.string(),
  start: z.number(),
  end: z.number()
})

const catalogSectionSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  code: z.string(),
  family: z.string(),
  regNum: z.number().int().nullable(),
  instructor: z.string().nullable(),
  cap: z.number().int().nullable(),
  avail: z.number().int().nullable(),
  wait: z.number().int().nullable(),
  cancelled: z.boolean(),
  meetings: z.array(catalogMeetingSchema),
  exams: z.array(catalogExamSchema)
})

const catalogCourseSchema = z.object({
  id: z.string(),
  subject: z.string(),
  number: z.string(),
  title: z.string(),
  unitsFrom: z.number(),
  unitsTo: z.number(),
  unitsInc: z.number(),
  sectionIds: z.array(z.string())
})

const catalogDataSchema = z.object({
  termId: z.string().trim().min(1).max(16),
  version: z.number().int().nonnegative(),
  generatedAt: z.string().datetime({ offset: true }),
  provenance: catalogProvenanceSchema,
  courses: z.record(catalogCourseSchema),
  sections: z.record(catalogSectionSchema)
})

const termsResponseSchema = z.object({ terms: z.array(apiTermSchema).max(256) })
const accountExportScheduleSchema = z.object({
  termId: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(60),
  sectionIds: z.array(z.string().trim().min(1).max(128)).max(40)
}).strict().superRefine((schedule, ctx) => {
  if (new Set(schedule.sectionIds).size !== schedule.sectionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sectionIds'], message: 'duplicate section ID' })
  }
})
const accountExportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  schedules: z.array(accountExportScheduleSchema).max(20)
}).strict()
const deleteAccountResponseSchema = z.object({ ok: z.literal(true) }).strict()

export type ApiTerm = z.infer<typeof apiTermSchema>
export type AccountExport = z.infer<typeof accountExportSchema>

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type ApiScheduleItem = { sectionId: string; status: string }
export type ApiSchedule = { id: string; termId: string; name: string; items: ApiScheduleItem[] }

async function readBoundedJson(res: Response, maxBytes: number): Promise<unknown> {
  const contentLength = res.headers.get('content-length')
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength)
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
      throw new ApiError(502, 'Invalid API response')
    }
    if (declaredBytes > maxBytes) throw new ApiError(502, 'API response too large')
  }

  if (!res.body) throw new ApiError(502, 'Invalid API response')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let json = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel()
        throw new ApiError(502, 'API response too large')
      }
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
    return JSON.parse(json) as unknown
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof SyntaxError) throw new ApiError(502, 'Invalid API response')
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await readBoundedJson(res, MAX_API_RESPONSE_BYTES)
      if (body && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string') {
        message = (body as Record<string, string>).error
      }
    } catch {
      // no JSON body; fall back to statusText
    }
    throw new ApiError(res.status, message)
  }
  return (await readBoundedJson(res, MAX_API_RESPONSE_BYTES)) as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }
}

type CatalogCacheEntry = { etag: string; payload: CatalogData }

// The validator and ETag enter the cache atomically, so a conditional request can never
// be issued from tag-only state.
const catalogCache = new Map<string, CatalogCacheEntry>()

function catalogRequestInit(etag: string | null, signal?: AbortSignal): RequestInit {
  return {
    headers: etag ? { 'If-None-Match': etag } : {},
    ...(signal ? { signal } : {})
  }
}

async function parseCatalogResponse(res: Response, termId: string): Promise<CatalogData> {
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  const parsed = catalogDataSchema.safeParse(await readBoundedJson(res, MAX_CATALOG_RESPONSE_BYTES))
  if (!parsed.success || parsed.data.termId !== termId) throw new ApiError(502, 'Invalid API response')
  return parsed.data
}

export async function fetchCatalog(termId: string, options: { signal?: AbortSignal } = {}): Promise<CatalogData> {
  const cached = catalogCache.get(termId)
  const url = `/api/catalog/${encodeURIComponent(termId)}`
  let res = await fetch(url, catalogRequestInit(cached?.etag ?? null, options.signal))

  if (res.status === 304) {
    if (cached) return cached.payload
    res = await fetch(url, catalogRequestInit(null, options.signal))
    if (res.status === 304) throw new ApiError(502, 'Invalid API response')
  }

  const payload = await parseCatalogResponse(res, termId)
  const nextEtag = res.headers.get('ETag')
  if (nextEtag) catalogCache.set(termId, { etag: nextEtag, payload })
  else catalogCache.delete(termId)

  return payload
}

export async function listTerms(): Promise<{ terms: ApiTerm[] }> {
  const res = await fetch('/api/terms')
  if (!res.ok) throw new ApiError(res.status, res.statusText)
  const parsed = termsResponseSchema.safeParse(await readBoundedJson(res, MAX_TERMS_RESPONSE_BYTES))
  if (!parsed.success) throw new ApiError(502, 'Invalid API response')
  return parsed.data
}

export function listSchedules(termId: string): Promise<{ schedules: ApiSchedule[] }> {
  return fetch(`/api/schedules?term=${encodeURIComponent(termId)}`).then(res => handle(res))
}

export function createSchedule(termId: string, name: string): Promise<ApiSchedule> {
  return fetch('/api/schedules', jsonInit('POST', { termId, name })).then(res => handle(res))
}

export function renameSchedule(id: string, name: string): Promise<ApiSchedule> {
  return fetch(`/api/schedules/${encodeURIComponent(id)}`, jsonInit('PATCH', { name })).then(res => handle(res))
}

export function deleteSchedule(id: string): Promise<{ ok: true }> {
  return fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(res => handle(res))
}

export function putScheduleItems(
  id: string,
  sectionIds: string[],
  options: { keepalive?: boolean } = {}
): Promise<{ id: string; items: ApiScheduleItem[] }> {
  return fetch(`/api/schedules/${encodeURIComponent(id)}/items`, {
    ...jsonInit('PUT', { sectionIds }),
    ...(options.keepalive ? { keepalive: true } : {})
  }).then(res => handle(res))
}

export function copySchedule(id: string, name: string): Promise<ApiSchedule> {
  return fetch(`/api/schedules/${encodeURIComponent(id)}/copy`, jsonInit('POST', { name })).then(res => handle(res))
}

export async function fetchAccountExport(): Promise<AccountExport> {
  const res = await fetch('/api/account/export')
  if (!res.ok) return handle<AccountExport>(res)
  const parsed = accountExportSchema.safeParse(await readBoundedJson(res, MAX_ACCOUNT_EXPORT_RESPONSE_BYTES))
  if (!parsed.success) throw new ApiError(502, 'Invalid API response')
  return parsed.data
}

export async function deleteAccount(): Promise<{ ok: true }> {
  const parsed = deleteAccountResponseSchema.safeParse(
    await fetch('/api/account', jsonInit('DELETE', { confirm: 'DELETE' })).then(res => handle<unknown>(res))
  )
  if (!parsed.success) throw new ApiError(502, 'Invalid API response')
  return parsed.data
}
