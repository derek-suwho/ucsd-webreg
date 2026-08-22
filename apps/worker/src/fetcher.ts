import { z } from 'zod'

const BASE = 'https://act.ucsd.edu/scheduleOfClasses'
const MAX_INFLIGHT = 4
const MIN_START_INTERVAL_MS = 200
const REQUEST_TIMEOUT_MS = 30_000
const BACKOFF_MS = [1000, 4000, 16000]

export const MAX_HTML_BYTES = 2 * 1024 * 1024
export const MAX_JSON_BYTES = 256 * 1024
export const MAX_DEPARTMENTS = 256

const departmentListSchema = z
  .array(z.object({ code: z.string().trim().min(1).max(32) }))
  .max(MAX_DEPARTMENTS)

export interface SocFetcherOpts {
  contactEmail: string
  fetchImpl?: typeof fetch
  /** Injectable sleep for exponential backoff, so tests don't actually wait. */
  delayFn?: (ms: number) => Promise<void>
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
  }
}

class UpstreamResponseError extends Error {}

interface BufferedResponse {
  status: number
  ok: boolean
  body: string
}

/** Fetches UCSD's public Schedule of Classes: cookie-bootstrapped session + politeness limits. */
export class SocFetcher {
  private readonly contactEmail: string
  private readonly fetchImpl: typeof fetch
  private readonly delayFn: (ms: number) => Promise<void>
  private readonly cookies = new Map<string, string>()

  private inflight = 0
  private lastStart = 0
  private readonly queue: Array<() => void> = []

  constructor(opts: SocFetcherOpts) {
    this.contactEmail = opts.contactEmail
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.delayFn = opts.delayFn ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async bootstrap(): Promise<void> {
    await this.request(
      `${BASE}/scheduleOfClassesStudent.htm`,
      'text/html',
      MAX_HTML_BYTES,
      false
    )
  }

  async fetchDepartmentList(termId: string): Promise<string[]> {
    const url = `${BASE}/department-list.json?selectedTerm=${encodeURIComponent(termId)}`
    const body = await this.request(url, 'application/json', MAX_JSON_BYTES)
    try {
      const depts = departmentListSchema.parse(JSON.parse(body))
      return depts.map(d => d.code)
    } catch {
      throw new Error('Invalid upstream department list')
    }
  }

  async fetchResultPage(termId: string, depts: string[], page: number): Promise<string> {
    const params = new URLSearchParams()
    params.set('selectedTerm', termId)
    params.set('tabNum', 'tabs-dept')
    for (const dept of depts) params.append('selectedDepartments', dept)
    params.set('page', String(page))
    const url = `${BASE}/scheduleOfClassesStudentResult.htm?${params.toString()}`
    return this.request(url, 'text/html', MAX_HTML_BYTES)
  }

  /** Runs one logical request: retries network errors/5xx with backoff, re-bootstraps once on 503. */
  private async request(
    url: string,
    expectedMediaType: string,
    maxBytes: number,
    allowReBootstrap = true
  ): Promise<string> {
    let attempt = 0
    for (;;) {
      try {
        const res = await this.rawFetch(url, expectedMediaType, maxBytes)
        if (res.status === 503 && allowReBootstrap) {
          await this.bootstrap()
          const retried = await this.rawFetch(url, expectedMediaType, maxBytes)
          if (!retried.ok) throw new HttpError(retried.status)
          return retried.body
        }
        if (res.status >= 500) throw new HttpError(res.status)
        if (!res.ok) throw new HttpError(res.status)
        return res.body
      } catch (err) {
        if (err instanceof HttpError && err.status < 500) throw err
        if (err instanceof UpstreamResponseError) throw err
        if (attempt >= BACKOFF_MS.length) throw err
        await this.delayFn(BACKOFF_MS[attempt])
        attempt++
      }
    }
  }

  /** One HTTP call: owns its slot and timeout until the response body is consumed or aborted. */
  private async rawFetch(
    url: string,
    expectedMediaType: string,
    maxBytes: number
  ): Promise<BufferedResponse> {
    await this.acquireSlot()
    const controller = new AbortController()
    const timeoutError = new Error('Upstream request timed out')
    const timer = setTimeout(() => controller.abort(timeoutError), REQUEST_TIMEOUT_MS)
    timer.unref?.()
    let response: Response | undefined
    let bodyHandled = false
    try {
      const headers: Record<string, string> = {
        'User-Agent': `webreg-revival/1.0 (contact: ${this.contactEmail})`
      }
      const cookieHeader = this.cookieHeader()
      if (cookieHeader) headers.Cookie = cookieHeader
      response = await this.fetchImpl(url, { headers, signal: controller.signal })
      this.storeCookies(response)
      if (!response.ok) {
        await cancelResponseBody(response, controller.signal)
        bodyHandled = true
        return { status: response.status, ok: false, body: '' }
      }

      requireMediaType(response, expectedMediaType)
      bodyHandled = true
      const body = await readBoundedText(response, maxBytes, controller.signal)
      return { status: response.status, ok: true, body }
    } catch (error) {
      if (response?.body && !bodyHandled && !response.body.locked) {
        await cancelResponseBody(response, controller.signal).catch(() => undefined)
      }
      if (!controller.signal.aborted) controller.abort(error)
      throw abortReason(controller.signal, error)
    } finally {
      clearTimeout(timer)
      this.releaseSlot()
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  private storeCookies(res: Response): void {
    const raw =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter((v): v is string => v != null)
    for (const entry of raw) {
      const pair = entry.split(';', 1)[0]
      const eq = pair.indexOf('=')
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }

  /** Global limiter: <=4 in-flight, >=200ms between request starts. */
  private acquireSlot(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
      this.pump()
    })
  }

  private releaseSlot(): void {
    this.inflight--
    this.pump()
  }

  private pump(): void {
    if (this.queue.length === 0 || this.inflight >= MAX_INFLIGHT) return
    const wait = Math.max(0, MIN_START_INTERVAL_MS - (Date.now() - this.lastStart))
    if (wait > 0) {
      const t = setTimeout(() => this.pump(), wait)
      t.unref?.()
      return
    }
    const resolve = this.queue.shift()!
    this.inflight++
    this.lastStart = Date.now()
    resolve()
  }
}

function requireMediaType(response: Response, expected: string): void {
  const actual = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (actual !== expected) {
    throw new UpstreamResponseError(`Unexpected upstream content type: expected ${expected}`)
  }
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<string> {
  if (!response.body) throw new UpstreamResponseError('Upstream response body is missing')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytesRead = 0
  let text = ''

  try {
    const contentLength = response.headers.get('content-length')
    if (contentLength != null) {
      if (!/^\d+$/.test(contentLength)) {
        throw new UpstreamResponseError('Invalid upstream Content-Length')
      }
      const declaredBytes = Number(contentLength)
      if (!Number.isSafeInteger(declaredBytes)) {
        throw new UpstreamResponseError('Invalid upstream Content-Length')
      }
      if (declaredBytes > maxBytes) {
        throw new UpstreamResponseError(`Upstream response body exceeds ${maxBytes} bytes`)
      }
    }

    for (;;) {
      const { done, value } = await waitWithAbort(reader.read(), signal)
      if (done) break
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        throw new UpstreamResponseError(`Upstream response body exceeds ${maxBytes} bytes`)
      }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    await cancelReader(reader, error, signal)
    throw abortReason(signal, error)
  } finally {
    reader.releaseLock()
  }
}

async function cancelResponseBody(response: Response, signal: AbortSignal): Promise<void> {
  if (!response.body) return
  await waitWithAbort(response.body.cancel(), signal)
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
  signal: AbortSignal
): Promise<void> {
  try {
    const cancellation = reader.cancel(reason)
    if (signal.aborted) {
      void cancellation.catch(() => undefined)
      return
    }
    await waitWithAbort(cancellation, signal)
  } catch {
    // The owning AbortController still bounds and aborts the upstream request.
  }
}

function waitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function abortReason(signal: AbortSignal, fallback?: unknown): unknown {
  if (signal.aborted && signal.reason !== undefined) return signal.reason
  return fallback ?? new Error('Upstream request aborted')
}
