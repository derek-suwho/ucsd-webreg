import { z } from 'zod'

const RedisUrlSchema = z.string().url().refine(value => {
  const protocol = new URL(value).protocol
  return protocol === 'redis:' || protocol === 'rediss:'
}, 'Invalid Redis URL')

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CONTACT_EMAIL: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Invalid email'),
  CATALOG_SOURCE: z.enum(['fixture', 'legacy-soc', 'tss']).default('fixture'),
  SEAT_REFRESH_MINUTES: z.coerce.number().int().positive().optional(),
  CATALOG_MAX_COURSES: z.coerce.number().int().positive().max(100_000).default(20_000),
  CATALOG_MAX_SECTIONS: z.coerce.number().int().positive().max(500_000).default(100_000),
  CATALOG_MAX_SNAPSHOT_BYTES: z.coerce.number().int().positive().max(128 * 1024 * 1024).default(32 * 1024 * 1024),
})
export type Env = z.infer<typeof EnvSchema>

const ExactHttpsOriginSchema = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && url.origin === value
}, 'Production APP_ORIGIN must be an exact HTTPS origin')

const WebEnvSchema = z.object({
  APP_ORIGIN: z.string().url().optional(),
  AUTH_URL: z.string().url().optional(),
  NEXTAUTH_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  REDIS_URL: RedisUrlSchema.optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),
  ENABLE_HSTS: z.enum(['true', 'false']).transform(value => value === 'true').default('false'),
})
export type WebEnv = z.infer<typeof WebEnvSchema>

export interface PgConnectionConfig {
  connectionString: string
  ssl?: { rejectUnauthorized: true }
}

const placeholderSecrets = new Set([
  'change-me-change-me-change-me-change-me',
  'replace_me_with_a_random_secret_value',
  'your-nextauth-secret-goes-here-now',
])

export function requireProductionDatabaseUrl(value: string | undefined): string {
  try {
    if (!value) throw new Error('invalid')
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('invalid')
    if (!url.username || !url.hostname || url.pathname === '/') throw new Error('invalid')
    if (url.searchParams.getAll('sslmode').length !== 1 || url.searchParams.get('sslmode') !== 'require') {
      throw new Error('invalid')
    }
    if (url.searchParams.getAll('sslaccept').length !== 1 || url.searchParams.get('sslaccept') !== 'strict') {
      throw new Error('invalid')
    }
    if (url.searchParams.has('ssl')) throw new Error('invalid')
    return url.href
  } catch {
    throw new Error('Production DATABASE_URL must use sslmode=require and sslaccept=strict')
  }
}

export function buildPgConnectionConfig(
  databaseUrl: string,
  nodeEnv: string | undefined = process.env.NODE_ENV
): PgConnectionConfig {
  if (nodeEnv !== 'production') return { connectionString: databaseUrl }

  const url = new URL(requireProductionDatabaseUrl(databaseUrl))
  url.searchParams.delete('sslmode')
  url.searchParams.delete('sslaccept')
  return {
    connectionString: url.href,
    ssl: { rejectUnauthorized: true }
  }
}

export function loadEnv(
  source: Record<string, string | undefined> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): Env {
  const env = EnvSchema.parse(source)
  if (nodeEnv === 'production') requireProductionDatabaseUrl(env.DATABASE_URL)
  if (nodeEnv === 'production' && source.CATALOG_SOURCE !== 'fixture') {
    throw new Error('Production CATALOG_SOURCE must be explicitly set to fixture')
  }
  return env
}

export function loadWebEnv(
  source: Record<string, string | undefined> = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): WebEnv {
  const env = WebEnvSchema.parse(source)
  if (nodeEnv !== 'production') return env

  requireProductionDatabaseUrl(source.DATABASE_URL)
  const appOrigin = ExactHttpsOriginSchema.parse(env.APP_ORIGIN)
  if (env.AUTH_URL !== undefined) {
    const authUrl = ExactHttpsOriginSchema.parse(env.AUTH_URL)
    if (authUrl !== appOrigin) {
      throw new Error('Production AUTH_URL must equal APP_ORIGIN')
    }
  }
  if (!env.NEXTAUTH_SECRET || Buffer.byteLength(env.NEXTAUTH_SECRET, 'utf8') < 32 || placeholderSecrets.has(env.NEXTAUTH_SECRET)) {
    throw new Error('Production NEXTAUTH_SECRET must be at least 32 UTF-8 bytes and not a placeholder')
  }
  if (!env.GOOGLE_CLIENT_ID?.trim() || !env.GOOGLE_CLIENT_SECRET?.trim()) {
    throw new Error('Production Google OAuth credentials are required')
  }
  if (!env.REDIS_URL || new URL(env.REDIS_URL).protocol !== 'rediss:') {
    throw new Error('Production REDIS_URL must use rediss:')
  }
  if (env.TRUSTED_PROXY_HOPS <= 0) {
    throw new Error('Production TRUSTED_PROXY_HOPS must be positive')
  }
  return env
}
