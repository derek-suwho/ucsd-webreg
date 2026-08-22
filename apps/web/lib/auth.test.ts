import type { GoogleProfile } from '@auth/core/providers/google'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type JwtCallback = (args: { token: Record<string, unknown>, profile?: GoogleProfile }) => Promise<Record<string, unknown>>
type AuthConfig = { callbacks: { jwt: JwtCallback } }

const mocks = vi.hoisted(() => ({
  google: vi.fn(() => ({ id: 'google' })),
  loadWebEnv: vi.fn(() => ({
    APP_ORIGIN: undefined,
    NEXTAUTH_SECRET: 'test-secret',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    REDIS_URL: undefined,
    TRUSTED_PROXY_HOPS: 0,
    ENABLE_HSTS: false
  })),
  nextAuth: vi.fn((config: AuthConfig) => {
    void config
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }
  }),
  upsert: vi.fn()
}))

vi.mock('next-auth', () => ({ default: mocks.nextAuth }))
vi.mock('next-auth/providers/google', () => ({ default: mocks.google }))
vi.mock('@webreg/config', () => ({ loadWebEnv: mocks.loadWebEnv }))
vi.mock('@webreg/db', () => ({ prisma: { user: { upsert: mocks.upsert } } }))

import './auth'

function jwtCallback(): JwtCallback {
  const config = mocks.nextAuth.mock.calls[0]?.[0]
  if (!config) throw new Error('NextAuth was not configured')
  return config.callbacks.jwt
}

describe('Auth.js Google profile handling', () => {
  beforeEach(() => {
    mocks.upsert.mockReset()
    mocks.upsert.mockResolvedValue({ id: 'user-1' })
  })

  it('configures Auth.js from validated web environment values', () => {
    expect(mocks.loadWebEnv).toHaveBeenCalledOnce()
    expect(mocks.google).toHaveBeenCalledWith({
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret'
    })
    expect(mocks.nextAuth).toHaveBeenCalledWith(expect.objectContaining({ secret: 'test-secret' }))
  })

  it('does not create a user from an unverified Google email', async () => {
    const profile: GoogleProfile = {
      aud: 'client', azp: 'client', email: 'student@example.test', email_verified: false,
      exp: 0, given_name: 'Student', iat: 0, iss: 'https://accounts.google.com', jti: 'id',
      locale: 'en', name: 'Student', nbf: 0, picture: '', sub: 'google-subject'
    }

    await jwtCallback()({ token: {}, profile })

    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('does not create a user from an empty verified Google email', async () => {
    const profile: GoogleProfile = {
      aud: 'client', azp: 'client', email: '   ', email_verified: true,
      exp: 0, given_name: 'Student', iat: 0, iss: 'https://accounts.google.com', jti: 'id',
      locale: 'en', name: 'Student', nbf: 0, picture: '', sub: 'google-subject'
    }

    await jwtCallback()({ token: {}, profile })

    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('creates a user from a verified nonempty Google email', async () => {
    const profile: GoogleProfile = {
      aud: 'client', azp: 'client', email: 'student@example.test', email_verified: true,
      exp: 0, given_name: 'Student', iat: 0, iss: 'https://accounts.google.com', jti: 'id',
      locale: 'en', name: 'Student', nbf: 0, picture: '', sub: 'google-subject'
    }

    const token = await jwtCallback()({ token: {}, profile })

    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { email: 'student@example.test' },
      create: { email: 'student@example.test', name: 'Student' },
      update: { name: 'Student' }
    })
    expect(token.uid).toBe('user-1')
  })
})
