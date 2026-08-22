import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config'
import { config, proxy } from '../proxy'
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders
} from './security-headers'

function directive(policy: string, name: string): string {
  return policy
    .split(';')
    .map(value => value.trim())
    .find(value => value.startsWith(`${name} `)) ?? ''
}

describe('buildContentSecurityPolicy', () => {
  it('restricts production scripts to the request nonce', () => {
    const policy = buildContentSecurityPolicy('dGVzdC1ub25jZQ==', true)
    const scripts = directive(policy, 'script-src')

    expect(scripts).toBe("script-src 'nonce-dGVzdC1ub25jZQ==' 'strict-dynamic'")
    expect(scripts).not.toContain("'unsafe-inline'")
    expect(scripts).not.toContain("'unsafe-eval'")
  })

  it('adds unsafe-eval, but not unsafe-inline, to development scripts', () => {
    const scripts = directive(
      buildContentSecurityPolicy('dGVzdC1ub25jZQ==', false),
      'script-src'
    )

    expect(scripts).toContain("'unsafe-eval'")
    expect(scripts).not.toContain("'unsafe-inline'")
  })

  it('denies framing, plugins, base tags, and external connections', () => {
    const policy = buildContentSecurityPolicy('dGVzdC1ub25jZQ==', true)

    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'")
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'")
    expect(directive(policy, 'form-action')).toBe("form-action 'self'")
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'")
  })

  it('allows only the asset schemes used by the app', () => {
    const policy = buildContentSecurityPolicy('dGVzdC1ub25jZQ==', true)

    expect(directive(policy, 'style-src')).toBe(
      "style-src 'self' 'nonce-dGVzdC1ub25jZQ=='"
    )
    expect(directive(policy, 'style-src-attr')).toBe(
      "style-src-attr 'unsafe-inline'"
    )
    expect(directive(policy, 'img-src')).toBe("img-src 'self' data: blob:")
    expect(directive(policy, 'font-src')).toBe("font-src 'self'")
  })
})

describe('buildSecurityHeaders', () => {
  it('returns browser security headers and opted-in production HSTS', () => {
    const headers = buildSecurityHeaders('dGVzdC1ub25jZQ==', {
      production: true,
      enableHsts: true
    })

    expect(headers.get('content-security-policy')).toContain(
      "script-src 'nonce-dGVzdC1ub25jZQ==' 'strict-dynamic'"
    )
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe('no-referrer')
    expect(headers.get('permissions-policy')).toBe(
      'camera=(), geolocation=(), microphone=(), payment=(), usb=()'
    )
    expect(headers.get('strict-transport-security')).toBe(
      'max-age=31536000'
    )
  })

  it('omits HSTS in production without explicit opt-in', () => {
    const headers = buildSecurityHeaders('dGVzdC1ub25jZQ==', {
      production: true,
      enableHsts: false
    })

    expect(headers.has('strict-transport-security')).toBe(false)
  })

  it('ignores HSTS opt-in outside production', () => {
    const headers = buildSecurityHeaders('dGVzdC1ub25jZQ==', {
      production: false,
      enableHsts: true
    })

    expect(headers.has('strict-transport-security')).toBe(false)
  })
})

describe('proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('generates a fresh cryptographically random nonce for each request', () => {
    const first = proxy(new NextRequest('https://example.test/'))
    const second = proxy(new NextRequest('https://example.test/'))
    const noncePattern = /'nonce-([^']+)'/
    const firstNonce = first.headers
      .get('content-security-policy')
      ?.match(noncePattern)?.[1]
    const secondNonce = second.headers
      .get('content-security-policy')
      ?.match(noncePattern)?.[1]

    expect(firstNonce).toBeTruthy()
    expect(secondNonce).toBeTruthy()
    expect(firstNonce).not.toBe(secondNonce)
    expect(Buffer.from(firstNonce!, 'base64').toString('utf8')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it('forwards the nonce and CSP to rendering and returns security headers', () => {
    const response = proxy(new NextRequest('https://example.test/api/terms'))
    const responsePolicy = response.headers.get('content-security-policy')
    const forwardedPolicy = response.headers.get(
      'x-middleware-request-content-security-policy'
    )
    const forwardedNonce = response.headers.get('x-middleware-request-x-nonce')

    expect(forwardedPolicy).toBe(responsePolicy)
    expect(responsePolicy).toContain(`'nonce-${forwardedNonce}'`)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('replaces hostile inbound CSP and nonce headers', () => {
    const response = proxy(new NextRequest('https://example.test/', {
      headers: {
        'content-security-policy': "script-src 'unsafe-inline' https:",
        'x-nonce': 'attacker-controlled'
      }
    }))

    expect(response.headers.get('content-security-policy')).not.toContain(
      'attacker-controlled'
    )
    const responsePolicy = response.headers.get('content-security-policy')!

    expect(directive(responsePolicy, 'script-src')).not.toContain(
      "'unsafe-inline'"
    )
    expect(responsePolicy).not.toContain('https:')
    expect(
      response.headers.get('x-middleware-request-content-security-policy')
    ).toBe(response.headers.get('content-security-policy'))
    expect(response.headers.get('x-middleware-request-x-nonce')).not.toBe(
      'attacker-controlled'
    )
  })

  it('emits HSTS only for an explicit production opt-in', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_HSTS', 'true')

    const response = proxy(new NextRequest('https://example.test/'))

    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=31536000'
    )
  })

  it('ignores ENABLE_HSTS outside production', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_HSTS', 'true')

    const response = proxy(new NextRequest('http://localhost:3000/'))

    expect(response.headers.has('strict-transport-security')).toBe(false)
  })

  it('omits HSTS in production without the exact opt-in value', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_HSTS', 'false')

    const response = proxy(new NextRequest('https://example.test/'))

    expect(response.headers.has('strict-transport-security')).toBe(false)
  })
})

describe('proxy matcher', () => {
  function matches(path: string): boolean {
    const pathname = new URL(path, 'https://example.test').pathname
    return new RegExp(`^${config.matcher}$`).test(pathname)
  }

  it.each(['/', '/courses', '/api/terms', '/api/auth/session'])(
    'protects %s',
    path => {
      expect(matches(path)).toBe(true)
    }
  )

  it.each([
    '/_next/static/chunks/app.js',
    '/_next/image?url=%2Flogo.png&w=640&q=75',
    '/favicon.ico'
  ])('excludes %s', path => {
    expect(matches(path)).toBe(false)
  })
})

describe('Next.js security configuration', () => {
  it('disables the framework signature header', () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })
})
