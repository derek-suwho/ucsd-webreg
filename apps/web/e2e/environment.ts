type Environment = Readonly<Record<string, string | undefined>>

export function requireE2eDatabaseUrl(source: Environment = process.env): string {
  const value = source.TEST_DATABASE_URL ?? source.DATABASE_URL
  if (!value) throw new Error('TEST_DATABASE_URL is required and must name a dedicated *_e2e database')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL for a dedicated *_e2e database')
  }
  const databaseName = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? '')
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !databaseName.endsWith('_e2e')) {
    throw new Error('TEST_DATABASE_URL must name a dedicated *_e2e PostgreSQL database')
  }
  return value
}
