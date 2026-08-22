import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogData } from '@webreg/catalog'

function catalog(termId: string, version: number): CatalogData {
  return {
    termId,
    version,
    generatedAt: '2026-08-21T12:00:00.000Z',
    provenance: {
      sourceKind: 'fixture',
      mode: 'demo',
      sourceGeneratedAt: '2026-08-21T11:00:00.000Z'
    },
    courses: {},
    sections: {}
  }
}

function catalogResponse(payload: CatalogData, etag: string): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ETag: etag } })
}

describe('catalog API client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('keeps ETags and payloads isolated by term and returns cached payloads on 304', async () => {
    const fall = catalog('FA26', 1)
    const winter = catalog('WI27', 2)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(catalogResponse(fall, '"fall-1"'))
      .mockResolvedValueOnce(catalogResponse(winter, '"winter-2"'))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchCatalog } = await import('./api-client')

    await expect(fetchCatalog('FA26')).resolves.toEqual(fall)
    await expect(fetchCatalog('WI27')).resolves.toEqual(winter)
    await expect(fetchCatalog('FA26')).resolves.toEqual(fall)
    await expect(fetchCatalog('WI27')).resolves.toEqual(winter)

    expect(fetchMock.mock.calls.map(([, init]) => init?.headers)).toEqual([
      {},
      {},
      { 'If-None-Match': '"fall-1"' },
      { 'If-None-Match': '"winter-2"' }
    ])
  })

  it('retries once without a condition when a 304 has no cached payload', async () => {
    const fall = catalog('FA26', 1)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(catalogResponse(fall, '"fall-1"'))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchCatalog } = await import('./api-client')

    await expect(fetchCatalog('FA26')).resolves.toEqual(fall)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({})
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({})
  })

  it('encodes the term as one URL path segment', async () => {
    const termId = 'FA 26/?#'
    const payload = catalog(termId, 1)
    const fetchMock = vi.fn().mockResolvedValue(catalogResponse(payload, '"encoded"'))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchCatalog } = await import('./api-client')

    await expect(fetchCatalog(termId)).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith('/api/catalog/FA%2026%2F%3F%23', { headers: {} })
  })

  it('does not retain an ETag unless its payload parsed successfully', async () => {
    const fall = catalog('FA26', 2)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{', { status: 200, headers: { ETag: '"bad"' } }))
      .mockResolvedValueOnce(catalogResponse(fall, '"good"'))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchCatalog } = await import('./api-client')

    await expect(fetchCatalog('FA26')).rejects.toThrow('Invalid API response')
    await expect(fetchCatalog('FA26')).resolves.toEqual(fall)

    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({})
  })

  it('rejects a catalog response declared beyond the client bound', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 200,
          headers: { 'Content-Length': String(128 * 1024 * 1024) }
        })
      )
    )
    const { fetchCatalog } = await import('./api-client')

    await expect(fetchCatalog('FA26')).rejects.toThrow('API response too large')
  })
})

describe('terms API client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('parses bounded term responses', async () => {
    const terms = [
      {
        id: 'FA26',
        name: 'Fall Quarter 2026',
        active: true,
        startsAt: '2026-09-24T00:00:00.000Z',
        endsAt: '2026-12-04T00:00:00.000Z'
      }
    ]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ terms }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { listTerms } = await import('./api-client')

    await expect(listTerms()).resolves.toEqual({ terms })
    expect(fetchMock).toHaveBeenCalledWith('/api/terms')
  })

  it('rejects malformed term responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ terms: [{ id: '', active: 'yes' }] }), { status: 200 }))
    )
    const { listTerms } = await import('./api-client')

    await expect(listTerms()).rejects.toThrow('Invalid API response')
  })

  it('rejects term response bytes beyond the client bound without trusting Content-Length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ terms: [], padding: 'x'.repeat(2 * 1024 * 1024) }), { status: 200 }))
    )
    const { listTerms } = await import('./api-client')

    await expect(listTerms()).rejects.toThrow('API response too large')
  })
})

describe('schedule API client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('encodes schedule IDs and opts lifecycle item saves into keepalive', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 's /?#', items: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { putScheduleItems } = await import('./api-client')

    await putScheduleItems('s /?#', ['A'], { keepalive: true })

    expect(fetchMock).toHaveBeenCalledWith('/api/schedules/s%20%2F%3F%23/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionIds: ['A'] }),
      keepalive: true
    })
  })

  it('encodes schedule IDs for every dynamic schedule route', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => (
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    ))
    vi.stubGlobal('fetch', fetchMock)
    const { copySchedule, deleteSchedule, renameSchedule } = await import('./api-client')

    await renameSchedule('s /?#', 'Renamed')
    await deleteSchedule('s /?#')
    await copySchedule('s /?#', 'Copy')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/schedules/s%20%2F%3F%23',
      '/api/schedules/s%20%2F%3F%23',
      '/api/schedules/s%20%2F%3F%23/copy'
    ])
  })
})

describe('account API client', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('validates and returns a bounded portable schedule export', async () => {
    const exported = {
      schemaVersion: 1,
      generatedAt: '2026-08-22T12:00:00.000Z',
      schedules: [
        { termId: 'FA26', name: 'Primary', sectionIds: ['FA26:CSE:110:A01'] }
      ]
    }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(exported), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAccountExport } = await import('./api-client')

    await expect(fetchAccountExport()).resolves.toEqual(exported)
    expect(fetchMock).toHaveBeenCalledWith('/api/account/export')
  })

  it('rejects malformed or oversized account exports', async () => {
    const tooManySchedules = {
      schemaVersion: 1,
      generatedAt: '2026-08-22T12:00:00.000Z',
      schedules: Array.from({ length: 21 }, (_, index) => ({
        termId: 'FA26', name: `Plan ${index}`, sectionIds: []
      }))
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tooManySchedules), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        schemaVersion: 1,
        generatedAt: 'not-a-date',
        schedules: []
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(512 * 1024) }
      }))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchAccountExport } = await import('./api-client')

    await expect(fetchAccountExport()).rejects.toThrow('Invalid API response')
    await expect(fetchAccountExport()).rejects.toThrow('Invalid API response')
    await expect(fetchAccountExport()).rejects.toThrow('API response too large')
  })

  it('deletes the authenticated account with a same-origin DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { deleteAccount } = await import('./api-client')

    await expect(deleteAccount()).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' })
    })
  })
})
