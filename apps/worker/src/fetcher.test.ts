import { afterEach, describe, it, expect, vi } from 'vitest'
import { SocFetcher } from './fetcher.js'

const htmlResponse = (body: BodyInit | null = 'page-html', init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { 'content-type': 'text/html; charset=utf-8', ...init.headers }
  })

const jsonResponse = (body: BodyInit | null, init: ResponseInit = {}) =>
  new Response(body, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  })

describe('SocFetcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends the identifying User-Agent header with contact email', async () => {
    const seenHeaders: Headers[] = []
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      seenHeaders.push(new Headers(init?.headers))
      return htmlResponse('form', { status: 200 })
    })
    const fetcher = new SocFetcher({
      contactEmail: 'test@example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await fetcher.bootstrap()

    expect(seenHeaders[0].get('user-agent')).toBe('webreg-revival/1.0 (contact: test@example.com)')
  })

  it('re-bootstraps once on 503 and returns the retried response', async () => {
    let resultCalls = 0
    let bootstrapCalls = 0
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('scheduleOfClassesStudentResult')) {
        resultCalls++
        return resultCalls === 1
          ? htmlResponse('', { status: 503 })
          : htmlResponse('page-html', { status: 200 })
      }
      bootstrapCalls++
      return htmlResponse('form', { status: 200 })
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delayFn: async () => {}
    })

    const html = await fetcher.fetchResultPage('FA26', ['CSE'], 1)

    expect(html).toBe('page-html')
    expect(resultCalls).toBe(2)
    expect(bootstrapCalls).toBe(1)
  })

  it('sends cookies from bootstrap on subsequent requests', async () => {
    const cookiesSeen: (string | null)[] = []
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers)
      cookiesSeen.push(h.get('cookie'))
      if (String(url).includes('scheduleOfClassesStudent.htm')) {
        return htmlResponse('form', {
          status: 200,
          headers: { 'set-cookie': 'jlinksessionidx=abc123; Path=/; HttpOnly' }
        })
      }
      return jsonResponse(JSON.stringify([{ code: 'CSE', value: 'Computer Science' }]), {
        status: 200
      })
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await fetcher.bootstrap()
    const depts = await fetcher.fetchDepartmentList('FA26')

    expect(depts).toEqual(['CSE'])
    expect(cookiesSeen[0]).toBeNull()
    expect(cookiesSeen[1]).toBe('jlinksessionidx=abc123')
  })

  it('limits in-flight requests to 4 concurrent, spacing starts >=190ms apart', async () => {
    let inflight = 0
    let maxInflight = 0
    const starts: number[] = []
    const fetchImpl = vi.fn(async () => {
      starts.push(Date.now())
      inflight++
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise((r) => setTimeout(r, 15))
      inflight--
      return htmlResponse('page-html', { status: 200 })
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    const N = 6
    await Promise.all(
      Array.from({ length: N }, (_, i) => fetcher.fetchResultPage('FA26', ['CSE'], i))
    )

    expect(fetchImpl).toHaveBeenCalledTimes(N)
    expect(maxInflight).toBeLessThanOrEqual(4)
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(190)
    }
  }, 10000)

  it('holds concurrency slots until stalled response bodies finish', async () => {
    vi.useFakeTimers()
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const fetchImpl = vi.fn(async () => htmlResponse(new ReadableStream<Uint8Array>({
      start(controller) {
        controllers.push(controller)
      }
    })))
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })
    const pending = Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        fetcher.fetchResultPage('FA26', ['CSE'], index)
      )
    )

    try {
      await vi.advanceTimersByTimeAsync(1_000)

      expect(fetchImpl).toHaveBeenCalledTimes(4)
    } finally {
      const startedBeforeRelease = controllers.length
      for (const controller of controllers) controller.close()
      await vi.advanceTimersByTimeAsync(1_000)
      for (const controller of controllers.slice(startedBeforeRelease)) controller.close()
      await pending
    }
  })

  it('aborts and cancels stalled response bodies at the request deadline', async () => {
    vi.useFakeTimers()
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
    const signals: AbortSignal[] = []
    const cancel = vi.fn()
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal)
      return htmlResponse(new ReadableStream<Uint8Array>({
        start(controller) {
          controllers.push(controller)
        },
        cancel
      }))
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delayFn: async () => {}
    })
    let outcome: unknown = 'pending'
    const pending = fetcher.fetchResultPage('FA26', ['CSE'], 1).then(
      value => { outcome = value },
      error => { outcome = error }
    )

    try {
      await vi.advanceTimersByTimeAsync(121_000)

      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toBe('Upstream request timed out')
      expect(signals).toHaveLength(4)
      expect(signals.every(signal => signal.aborted)).toBe(true)
      expect(cancel).toHaveBeenCalledTimes(4)
    } finally {
      for (const controller of controllers) {
        try {
          controller.close()
        } catch {
          // Already canceled by the implementation under test.
        }
      }
      await pending
    }
  })

  it('503 then persistent 500s: throws after backoff retries exhausted', async () => {
    let resultCalls = 0
    let bootstrapCalls = 0
    const delays: number[] = []
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url)
      if (u.includes('scheduleOfClassesStudentResult')) {
        resultCalls++
        return resultCalls === 1
          ? htmlResponse('', { status: 503 })
          : htmlResponse('', { status: 500 })
      }
      bootstrapCalls++
      return htmlResponse('form', { status: 200 })
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      delayFn: async (ms) => {
        delays.push(ms)
      }
    })

    await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow('HTTP 500')

    // 1 initial 503 + 1 retry-after-bootstrap 500 + 3 backoff retries, all 500
    expect(resultCalls).toBe(5)
    expect(bootstrapCalls).toBe(1)
    expect(delays).toEqual([1000, 4000, 16000])
  })

  it('captures multiple Set-Cookie headers and sends both on subsequent requests', async () => {
    const cookiesSeen: (string | null)[] = []
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const h = new Headers(init?.headers)
      cookiesSeen.push(h.get('cookie'))
      if (String(url).includes('scheduleOfClassesStudent.htm')) {
        const headers = new Headers()
        headers.set('content-type', 'text/html; charset=utf-8')
        headers.append('set-cookie', 'jlinksessionidx=abc123; Path=/; HttpOnly')
        headers.append('set-cookie', 'other=xyz789; Path=/; Secure')
        return new Response('form', { status: 200, headers })
      }
      return jsonResponse(JSON.stringify([{ code: 'CSE', value: 'Computer Science' }]), {
        status: 200
      })
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    await fetcher.bootstrap()
    await fetcher.fetchDepartmentList('FA26')

    expect(cookiesSeen[1]).toContain('jlinksessionidx=abc123')
    expect(cookiesSeen[1]).toContain('other=xyz789')
    expect(cookiesSeen[1]).not.toContain('Path')
    expect(cookiesSeen[1]).not.toContain('HttpOnly')
    expect(cookiesSeen[1]).not.toContain('Secure')
  })

  it('cancels non-success response bodies', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () => htmlResponse(body, { status: 404 })) as unknown as typeof fetch,
      delayFn: async () => {}
    })

    await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow('HTTP 404')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects an unexpected result-page media type', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () =>
        jsonResponse(JSON.stringify({ html: 'not actually html' }))
      ) as unknown as typeof fetch
    })

    await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow(
      'Unexpected upstream content type'
    )
  })

  it('rejects an unexpected department-list media type', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () => htmlResponse('[{"code":"CSE"}]')) as unknown as typeof fetch
    })

    await expect(fetcher.fetchDepartmentList('FA26')).rejects.toThrow(
      'Unexpected upstream content type'
    )
  })

  it('rejects a successful response whose body stream is missing', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () => htmlResponse(null)) as unknown as typeof fetch
    })

    await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow(
      'Upstream response body is missing'
    )
  })

  it.each(['not-a-number', '-1', '1.5'])(
    'rejects an invalid Content-Length value of %s',
    async contentLength => {
      const fetcher = new SocFetcher({
        contactEmail: 'a@b.com',
        fetchImpl: vi.fn(async () =>
          htmlResponse('small', { headers: { 'content-length': contentLength } })
        ) as unknown as typeof fetch
      })

      await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow(
        'Invalid upstream Content-Length'
      )
    }
  )

  it('rejects a declared HTML body above 2 MiB', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () =>
        htmlResponse('small', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })
      ) as unknown as typeof fetch
    })

    await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow(
      'Upstream response body exceeds'
    )
  })

  it('rejects a declared JSON body above 256 KiB', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () =>
        jsonResponse('[]', { headers: { 'content-length': String(256 * 1024 + 1) } })
      ) as unknown as typeof fetch
    })

    await expect(fetcher.fetchDepartmentList('FA26')).rejects.toThrow(
      'Upstream response body exceeds'
    )
  })

  it('rejects streamed HTML bodies above 2 MiB', async () => {
    const chunk = new Uint8Array(64 * 1024)
    let emitted = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted++ < 33) controller.enqueue(chunk)
        else controller.close()
      }
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () => htmlResponse(body)) as unknown as typeof fetch
    })

    await expect(fetcher.fetchResultPage('FA26', ['CSE'], 1)).rejects.toThrow(
      'Upstream response body exceeds'
    )
  })

  it('rejects streamed JSON bodies above 256 KiB', async () => {
    const chunk = new Uint8Array(64 * 1024)
    let emitted = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted++ < 5) controller.enqueue(chunk)
        else controller.close()
      }
    })
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () =>
        jsonResponse(body, { headers: { 'content-length': '1' } })
      ) as unknown as typeof fetch
    })

    await expect(fetcher.fetchDepartmentList('FA26')).rejects.toThrow(
      'Upstream response body exceeds'
    )
  })

  it('rejects malformed department JSON', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () => jsonResponse('{"not":')) as unknown as typeof fetch
    })

    await expect(fetcher.fetchDepartmentList('FA26')).rejects.toThrow(
      'Invalid upstream department list'
    )
  })

  it('rejects invalid department entries', async () => {
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () =>
        jsonResponse(JSON.stringify([{ code: '' }, { code: 123 }]))
      ) as unknown as typeof fetch
    })

    await expect(fetcher.fetchDepartmentList('FA26')).rejects.toThrow(
      'Invalid upstream department list'
    )
  })

  it('rejects department lists above 256 entries', async () => {
    const departments = Array.from({ length: 257 }, (_, index) => ({ code: `D${index}` }))
    const fetcher = new SocFetcher({
      contactEmail: 'a@b.com',
      fetchImpl: vi.fn(async () => jsonResponse(JSON.stringify(departments))) as unknown as typeof fetch
    })

    await expect(fetcher.fetchDepartmentList('FA26')).rejects.toThrow(
      'Invalid upstream department list'
    )
  })
})
