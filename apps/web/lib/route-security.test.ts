import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InMemoryRateLimitStore,
  setRateLimitStoreForTests
} from './rate-limit'
import {
  enforceMutationOrigin,
  enforceIpRateLimit,
  enforceUserRateLimit,
  withIpRateLimit,
  type RouteRateLimit
} from './route-security'

const policy: RouteRateLimit = {
  bucket: 'test',
  limit: 1,
  windowSeconds: 60
}

describe('route rate limiting', () => {
  afterEach(() => {
    setRateLimitStoreForTests(undefined)
    vi.unstubAllEnvs()
  })

  it('allows a request below the per-IP limit', async () => {
    const request = new Request('https://example.test/api', {
      headers: { 'x-forwarded-for': '198.51.100.1' }
    })

    await expect(enforceIpRateLimit(request, policy, {
      store: new InMemoryRateLimitStore(() => 0),
      trustedProxyHops: 1,
      production: true
    })).resolves.toBeNull()
  })

  it('returns 429 and Retry-After when the per-IP limit is exceeded', async () => {
    const store = new InMemoryRateLimitStore(() => 0)
    const request = new Request('https://example.test/api', {
      headers: { 'x-forwarded-for': '198.51.100.1' }
    })

    await enforceIpRateLimit(request, policy, { store, trustedProxyHops: 1, production: true })
    const response = await enforceIpRateLimit(request, policy, {
      store,
      trustedProxyHops: 1,
      production: true
    })

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toBe('60')
  })

  it('returns a generic 503 when a production limiter store fails', async () => {
    const request = new Request('https://example.test/api', {
      headers: { 'x-forwarded-for': '198.51.100.1' }
    })
    const store = {
      increment: async () => {
        throw new Error('sensitive connection detail')
      }
    }

    const response = await enforceIpRateLimit(request, policy, {
      store,
      trustedProxyHops: 1,
      production: true
    })

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({ error: 'service unavailable' })
  })

  it('uses independent authenticated user keys for mutation limits', async () => {
    const store = new InMemoryRateLimitStore(() => 0)

    await expect(enforceUserRateLimit('user-1', policy, { store })).resolves.toBeNull()
    await expect(enforceUserRateLimit('user-2', policy, { store })).resolves.toBeNull()
    await expect(enforceUserRateLimit('user-1', policy, { store }))
      .resolves.toMatchObject({ status: 429 })
  })

  it('preserves wrapped handler arguments and skips it when limited', async () => {
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
    setRateLimitStoreForTests(new InMemoryRateLimitStore(() => 0))
    const handler = vi.fn(async (_request: Request, context: { action: string }) =>
      Response.json({ action: context.action })
    )
    const wrapped = withIpRateLimit(handler, policy)
    const request = new Request('https://example.test/api/auth/session', {
      headers: { 'x-forwarded-for': '198.51.100.1' }
    })

    const allowed = await wrapped(request, { action: 'session' })
    const limited = await wrapped(request, { action: 'session' })

    expect(await allowed.json()).toEqual({ action: 'session' })
    expect(limited.status).toBe(429)
    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(request, { action: 'session' })
  })
})

describe('schedule mutation origins', () => {
  const appOrigin = 'https://webreg.example.test'

  it('accepts the exact production origin', async () => {
    const request = new Request(`${appOrigin}/api/schedules`, {
      method: 'POST',
      headers: { Origin: appOrigin }
    })

    expect(enforceMutationOrigin(request, { appOrigin, production: true })).toBeNull()
  })

  it.each([
    ['mismatched', 'https://attacker.example.test'],
    ['prefix-matched', 'https://webreg.example.test.attacker.test'],
    ['missing', undefined]
  ])('rejects a %s production origin', async (_label, origin) => {
    const request = new Request(`${appOrigin}/api/schedules`, {
      method: 'POST',
      headers: origin ? { Origin: origin } : undefined
    })

    const response = enforceMutationOrigin(request, { appOrigin, production: true })

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('allows a mismatched origin outside production', () => {
    const request = new Request('http://localhost:3000/api/schedules', {
      method: 'POST',
      headers: { Origin: 'http://other.localhost:3000' }
    })

    expect(enforceMutationOrigin(request, { production: false })).toBeNull()
  })
})
