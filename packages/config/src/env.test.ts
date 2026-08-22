import { describe, it, expect } from 'vitest'
import { buildPgConnectionConfig, loadEnv, loadWebEnv } from './env'

const PRODUCTION_DATABASE_URL =
  'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'

describe('loadEnv', () => {
  it('parses valid env', () => {
    const env = loadEnv({ DATABASE_URL: 'postgresql://x', CONTACT_EMAIL: 'a@b.c' })
    expect(env.DATABASE_URL).toBe('postgresql://x')
    expect(env.CATALOG_SOURCE).toBe('fixture')
    expect(env.CATALOG_MAX_COURSES).toBe(20_000)
    expect(env.CATALOG_MAX_SECTIONS).toBe(100_000)
    expect(env.CATALOG_MAX_SNAPSHOT_BYTES).toBe(32 * 1024 * 1024)
  })
  it('throws on missing DATABASE_URL', () => {
    expect(() => loadEnv({ CONTACT_EMAIL: 'a@b.c' })).toThrow()
  })

  it('requires explicit fixture source in production without web-only settings', () => {
    const base = {
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      CONTACT_EMAIL: 'a@b.c',
      CATALOG_SOURCE: 'fixture'
    }

    expect(loadEnv(base, 'production')).toEqual({
      ...base,
      CATALOG_MAX_COURSES: 20_000,
      CATALOG_MAX_SECTIONS: 100_000,
      CATALOG_MAX_SNAPSHOT_BYTES: 32 * 1024 * 1024
    })
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL, CONTACT_EMAIL: base.CONTACT_EMAIL }, 'production'))
      .toThrow('Production CATALOG_SOURCE must be explicitly set to fixture')
    expect(() => loadEnv({ ...base, CATALOG_SOURCE: 'legacy-soc' }, 'production'))
      .toThrow('Production CATALOG_SOURCE must be explicitly set to fixture')
  })

  it('does not expose web or credential-like settings to the worker', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://x',
      CONTACT_EMAIL: 'a@b.c',
      NEXTAUTH_SECRET: 'web-only',
      REDIS_URL: 'redis://localhost:6379',
      TRUSTED_PROXY_HOPS: '2',
      TSS_PASSWORD: 'do-not-accept',
      TSS_COOKIE: 'do-not-accept',
      TSS_TOKEN: 'do-not-accept'
    }, 'test')

    expect(env).toEqual({
      DATABASE_URL: 'postgresql://x',
      CONTACT_EMAIL: 'a@b.c',
      CATALOG_SOURCE: 'fixture',
      CATALOG_MAX_COURSES: 20_000,
      CATALOG_MAX_SECTIONS: 100_000,
      CATALOG_MAX_SNAPSHOT_BYTES: 32 * 1024 * 1024
    })
  })

  it('parses positive bounded snapshot limit overrides', () => {
    expect(loadEnv({
      DATABASE_URL: 'postgresql://x',
      CONTACT_EMAIL: 'a@b.c',
      CATALOG_MAX_COURSES: '1',
      CATALOG_MAX_SECTIONS: '2',
      CATALOG_MAX_SNAPSHOT_BYTES: '3'
    })).toMatchObject({
      CATALOG_MAX_COURSES: 1,
      CATALOG_MAX_SECTIONS: 2,
      CATALOG_MAX_SNAPSHOT_BYTES: 3
    })
  })

  it.each(['0', '-1', '1.5', '999999999999999999999'])('rejects invalid snapshot limit %s', value => {
    expect(() => loadEnv({
      DATABASE_URL: 'postgresql://x',
      CONTACT_EMAIL: 'a@b.c',
      CATALOG_MAX_COURSES: value
    })).toThrow()
  })

  it.each([
    ['plaintext', 'postgresql://web_runtime:secret@db.example.com:5432/webreg'],
    ['Prisma verify-full', 'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=verify-full&sslaccept=strict'],
    ['missing strict acceptance', 'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require'],
    ['invalid certificate acceptance', 'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=accept_invalid_certs'],
    ['duplicate TLS mode', 'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslmode=require&sslaccept=strict'],
    ['pg certificate bypass', `${PRODUCTION_DATABASE_URL}&ssl=no-verify`],
    ['pg TLS disable', `${PRODUCTION_DATABASE_URL}&ssl=0`],
    ['duplicate pg TLS override', `${PRODUCTION_DATABASE_URL}&ssl=true&ssl=no-verify`]
  ])('rejects a production worker database URL with %s', (_case, DATABASE_URL) => {
    expect(() => loadEnv({
      DATABASE_URL,
      CONTACT_EMAIL: 'a@b.c',
      CATALOG_SOURCE: 'fixture'
    }, 'production')).toThrow('Production DATABASE_URL must use sslmode=require and sslaccept=strict')
  })

  it('builds an explicitly verified pg connection from the shared production URL', () => {
    const config = buildPgConnectionConfig(
      `${PRODUCTION_DATABASE_URL}&application_name=catalog-worker`,
      'production'
    )

    expect(config).toEqual({
      connectionString:
        'postgresql://web_runtime:secret@db.example.com:5432/webreg?application_name=catalog-worker',
      ssl: { rejectUnauthorized: true }
    })
  })
})

describe('loadWebEnv', () => {
  const validProduction = {
    DATABASE_URL: PRODUCTION_DATABASE_URL,
    APP_ORIGIN: 'https://webreg.example.com',
    NEXTAUTH_SECRET: 's'.repeat(32),
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    REDIS_URL: 'rediss://redis.example.com',
    TRUSTED_PROXY_HOPS: '1',
    ENABLE_HSTS: 'true'
  }

  it('parses a complete production web environment', () => {
    expect(loadWebEnv(validProduction, 'production')).toEqual({
      APP_ORIGIN: 'https://webreg.example.com',
      NEXTAUTH_SECRET: validProduction.NEXTAUTH_SECRET,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      REDIS_URL: 'rediss://redis.example.com',
      TRUSTED_PROXY_HOPS: 1,
      ENABLE_HSTS: true
    })
  })

  it.each([
    'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=verify-full&sslaccept=strict',
    'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require',
    'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=accept_invalid_certs'
  ])('rejects a non-strict production web database URL %s', DATABASE_URL => {
    expect(() => loadWebEnv({ ...validProduction, DATABASE_URL }, 'production'))
      .toThrow('Production DATABASE_URL must use sslmode=require and sslaccept=strict')
  })

  it.each([
    ['HTTP', { APP_ORIGIN: 'http://webreg.example.com' }],
    ['path', { APP_ORIGIN: 'https://webreg.example.com/login' }],
    ['query', { APP_ORIGIN: 'https://webreg.example.com?next=login' }],
    ['hash', { APP_ORIGIN: 'https://webreg.example.com#login' }],
    ['userinfo', { APP_ORIGIN: 'https://user:pass@webreg.example.com' }]
  ])('rejects a production APP_ORIGIN containing %s', (_label, override) => {
    expect(() => loadWebEnv({ ...validProduction, ...override }, 'production')).toThrow()
  })

  it('measures NEXTAUTH_SECRET in UTF-8 bytes', () => {
    expect(loadWebEnv({
      ...validProduction,
      NEXTAUTH_SECRET: '🔐'.repeat(8)
    }, 'production').NEXTAUTH_SECRET).toBe('🔐'.repeat(8))
    expect(() => loadWebEnv({
      ...validProduction,
      NEXTAUTH_SECRET: 'a'.repeat(31)
    }, 'production')).toThrow()
  })

  it.each([
    'change-me-change-me-change-me-change-me',
    'replace_me_with_a_random_secret_value',
    'your-nextauth-secret-goes-here-now'
  ])('rejects an obvious production secret placeholder', NEXTAUTH_SECRET => {
    expect(() => loadWebEnv({
      ...validProduction,
      NEXTAUTH_SECRET
    }, 'production')).toThrow()
  })

  it.each([
    ['GOOGLE_CLIENT_ID', ''],
    ['GOOGLE_CLIENT_SECRET', '   '],
    ['REDIS_URL', 'redis://redis.example.com'],
    ['TRUSTED_PROXY_HOPS', '0']
  ])('rejects invalid production %s', (key, value) => {
    expect(() => loadWebEnv({
      ...validProduction,
      [key]: value
    }, 'production')).toThrow()
  })

  it('keeps web-only values optional outside production', () => {
    expect(loadWebEnv({}, 'test')).toEqual({
      TRUSTED_PROXY_HOPS: 0,
      ENABLE_HSTS: false
    })
    expect(loadWebEnv({
      APP_ORIGIN: 'http://localhost:3000',
      NEXTAUTH_SECRET: 'dev-secret',
      GOOGLE_CLIENT_ID: 'dev-client',
      GOOGLE_CLIENT_SECRET: 'dev-client-secret',
      REDIS_URL: 'redis://localhost:6379',
      TRUSTED_PROXY_HOPS: '0',
      ENABLE_HSTS: 'true'
    }, 'development')).toMatchObject({
      APP_ORIGIN: 'http://localhost:3000',
      ENABLE_HSTS: true
    })
  })

  it.each(['TRUE', '1', 'yes', ''])('rejects ambiguous ENABLE_HSTS value %j', ENABLE_HSTS => {
    expect(() => loadWebEnv({ ENABLE_HSTS }, 'test')).toThrow()
  })

  it('does not allow NODE_ENV in the source to downgrade production validation', () => {
    expect(() => loadWebEnv({ NODE_ENV: 'test' }, 'production')).toThrow()
  })

  it('rejects a production AUTH_URL that differs from APP_ORIGIN', () => {
    expect(() => loadWebEnv({
      ...validProduction,
      AUTH_URL: 'https://auth.example.com'
    }, 'production')).toThrow('Production AUTH_URL must equal APP_ORIGIN')
  })
})
