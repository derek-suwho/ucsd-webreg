import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mocks, policies } = vi.hoisted(() => ({
  mocks: {
    enforceIpRateLimit: vi.fn(),
    enforceUserRateLimit: vi.fn(),
    enforceMutationOrigin: vi.fn(),
    withIpRateLimit: vi.fn(),
    authGet: vi.fn(),
    authPost: vi.fn()
  },
  policies: {
    terms: { bucket: 'terms', limit: 120, windowSeconds: 60 },
    seats: { bucket: 'seats', limit: 120, windowSeconds: 60 },
    catalog: { bucket: 'catalog', limit: 30, windowSeconds: 60 },
    health: { bucket: 'health', limit: 20, windowSeconds: 60 },
    auth: { bucket: 'auth', limit: 10, windowSeconds: 60 },
    scheduleMutation: { bucket: 'schedule-mutation', limit: 30, windowSeconds: 60 },
    accountExport: { bucket: 'account-export', limit: 5, windowSeconds: 60 },
    accountDelete: { bucket: 'account-delete', limit: 3, windowSeconds: 3600 }
  }
}))

vi.mock('../lib/route-security', () => ({
  RATE_LIMITS: policies,
  enforceIpRateLimit: mocks.enforceIpRateLimit,
  enforceUserRateLimit: mocks.enforceUserRateLimit,
  enforceMutationOrigin: mocks.enforceMutationOrigin,
  withIpRateLimit: mocks.withIpRateLimit.mockImplementation((handler, policy) =>
    async (request: Request, ...args: unknown[]) =>
      await mocks.enforceIpRateLimit(request, policy) ?? handler(request, ...args)
  )
}))

vi.mock('../lib/require-user', () => ({
  requireUser: () => Promise.resolve({ id: 'user-1' })
}))

vi.mock('../lib/auth', () => ({
  handlers: {
    GET: mocks.authGet,
    POST: mocks.authPost
  }
}))

vi.mock('@webreg/db', () => ({
  prisma: {},
  Prisma: {
    TransactionIsolationLevel: { Serializable: 'Serializable' },
    PrismaClientKnownRequestError: class extends Error {}
  }
}))

import { GET as termsGET } from '../app/api/terms/route'
import { GET as catalogGET } from '../app/api/catalog/[termId]/route'
import { GET as seatsGET } from '../app/api/seats/[termId]/route'
import { GET as healthGET } from '../app/api/health/route'
import { GET as authGET, POST as authPOST } from '../app/api/auth/[...nextauth]/route'
import { POST as schedulePOST } from '../app/api/schedules/route'
import { PATCH as schedulePATCH, DELETE as scheduleDELETE } from '../app/api/schedules/[id]/route'
import { PUT as itemsPUT } from '../app/api/schedules/[id]/items/route'
import { POST as copyPOST } from '../app/api/schedules/[id]/copy/route'
import { GET as accountExportGET } from '../app/api/account/export/route'
import { DELETE as accountDELETE } from '../app/api/account/route'

const limited = () => Response.json(
  { error: 'too many requests' },
  { status: 429, headers: { 'Retry-After': '60' } }
)

describe('API route rate-limit wiring', () => {
  beforeEach(() => {
    mocks.enforceIpRateLimit.mockReset()
    mocks.enforceUserRateLimit.mockReset()
    mocks.enforceMutationOrigin.mockReset()
    mocks.enforceIpRateLimit.mockResolvedValue(limited())
    mocks.enforceUserRateLimit.mockResolvedValue(limited())
  })

  it('protects every public data route by client IP', async () => {
    const request = new Request('https://example.test/api')
    const responses = await Promise.all([
      termsGET(request),
      catalogGET(request, { params: Promise.resolve({ termId: 'FA26' }) }),
      seatsGET(request, { params: Promise.resolve({ termId: 'FA26' }) }),
      healthGET(request)
    ])

    expect(responses.map(response => response.status)).toEqual([429, 429, 429, 429])
    expect(mocks.enforceIpRateLimit.mock.calls.map(call => call[1])).toEqual([
      policies.terms,
      policies.catalog,
      policies.seats,
      policies.health
    ])
  })

  it('protects both Auth.js handlers while preserving their request signature', async () => {
    const request = new NextRequest('https://example.test/api/auth/session')

    expect((await authGET(request)).status).toBe(429)
    expect((await authPOST(request)).status).toBe(429)
    expect(mocks.withIpRateLimit).toHaveBeenCalledWith(mocks.authGet, policies.auth)
    expect(mocks.withIpRateLimit).toHaveBeenCalledWith(mocks.authPost, policies.auth)
    expect(mocks.authGet).not.toHaveBeenCalled()
    expect(mocks.authPost).not.toHaveBeenCalled()
  })

  it('rate-limits every schedule mutation after authentication', async () => {
    const request = new Request('https://example.test/api/schedules', { method: 'POST' })
    const context = { params: Promise.resolve({ id: 'schedule-1' }) }
    const responses = await Promise.all([
      schedulePOST(request),
      schedulePATCH(request, context),
      scheduleDELETE(request, context),
      itemsPUT(request, context),
      copyPOST(request, context)
    ])

    expect(responses.map(response => response.status)).toEqual([429, 429, 429, 429, 429])
    expect(mocks.enforceUserRateLimit).toHaveBeenCalledTimes(5)
    expect(mocks.enforceUserRateLimit).toHaveBeenCalledWith('user-1', policies.scheduleMutation)
  })

  it('rate-limits account export and deletion with separate user policies', async () => {
    const responses = await Promise.all([
      accountExportGET(),
      accountDELETE(new Request('https://example.test/api/account', { method: 'DELETE' }))
    ])

    expect(responses.map(response => response.status)).toEqual([429, 429])
    expect(mocks.enforceUserRateLimit).toHaveBeenCalledWith('user-1', policies.accountExport)
    expect(mocks.enforceUserRateLimit).toHaveBeenCalledWith('user-1', policies.accountDelete)
  })
})
