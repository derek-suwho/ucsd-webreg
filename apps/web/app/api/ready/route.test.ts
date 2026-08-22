import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ checkReadiness: vi.fn() }))

vi.mock('../../../lib/readiness', () => ({
  checkReadiness: mocks.checkReadiness
}))

import { GET } from './route'

describe('GET /api/ready', () => {
  beforeEach(() => {
    mocks.checkReadiness.mockReset()
  })

  it('returns 200 only when required dependencies are ready', async () => {
    mocks.checkReadiness.mockResolvedValue(true)

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('returns a generic 503 when a required dependency is unavailable', async () => {
    mocks.checkReadiness.mockResolvedValue(false)

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ ok: false })
  })
})
