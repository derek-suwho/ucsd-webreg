import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let originalAuthUrl: string | undefined
let originalNextAuthUrl: string | undefined

describe('Auth.js production handler', () => {
  beforeEach(() => {
    originalAuthUrl = process.env.AUTH_URL
    originalNextAuthUrl = process.env.NEXTAUTH_URL
    delete process.env.AUTH_URL
    delete process.env.NEXTAUTH_URL
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'
    )
    vi.stubEnv('APP_ORIGIN', 'https://webreg.example.com')
    vi.stubEnv('NEXTAUTH_SECRET', 's'.repeat(32))
    vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
    vi.stubEnv('REDIS_URL', 'rediss://redis.example.com')
    vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalAuthUrl === undefined) delete process.env.AUTH_URL
    else process.env.AUTH_URL = originalAuthUrl
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL
    else process.env.NEXTAUTH_URL = originalNextAuthUrl
    vi.resetModules()
  })

  it('uses APP_ORIGIN as the canonical URL without trusting the request host', async () => {
    const { handlers } = await import('./auth')
    const response = await handlers.GET(
      new NextRequest('https://spoofed.example/api/auth/providers')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      google: {
        signinUrl: 'https://webreg.example.com/api/auth/signin/google',
        callbackUrl: 'https://webreg.example.com/api/auth/callback/google'
      }
    })
  })
})
