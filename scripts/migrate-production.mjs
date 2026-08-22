import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATION_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 64 * 1024
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(scriptDirectory)
const schemaPath = join(repositoryRoot, 'packages/db/prisma/schema.prisma')

function parseStrictPostgresUrl(value) {
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
  return url
}

function validateEnvironment(environment) {
  try {
    if (environment.NODE_ENV !== 'production') throw new Error('invalid')
    const runtimeUrl = parseStrictPostgresUrl(environment.DATABASE_URL)
    const migrationUrl = parseStrictPostgresUrl(environment.MIGRATION_DATABASE_URL)
    if (runtimeUrl.href === migrationUrl.href || runtimeUrl.username === migrationUrl.username) {
      throw new Error('invalid')
    }
    return migrationUrl.href
  } catch {
    throw new Error('Production migration configuration invalid')
  }
}

export function migrateProduction(environment = process.env, dependencies = {}) {
  const migrationUrl = validateEnvironment(environment)
  const run = dependencies.execFileSync ?? execFileSync
  const nodePath = dependencies.nodePath ?? process.execPath
  const prismaCliPath =
    dependencies.prismaCliPath ?? createRequire(import.meta.url).resolve('prisma/build/index.js')
  const childEnvironment = { ...environment, DATABASE_URL: migrationUrl }
  delete childEnvironment.MIGRATION_DATABASE_URL

  try {
    run(
      nodePath,
      [prismaCliPath, 'migrate', 'deploy', '--schema', schemaPath],
      {
        cwd: repositoryRoot,
        env: childEnvironment,
        shell: false,
        timeout: MIGRATION_TIMEOUT_MS,
        killSignal: 'SIGTERM',
        maxBuffer: MAX_OUTPUT_BYTES,
        stdio: 'pipe'
      }
    )
  } catch {
    throw new Error('Production migration failed')
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  try {
    migrateProduction()
    process.stdout.write('Production migrations applied\n')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
