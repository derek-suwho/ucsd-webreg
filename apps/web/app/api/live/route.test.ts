import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('GET /api/live', () => {
  it('reports process liveness without a dependency payload', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })
})
