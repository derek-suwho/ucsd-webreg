import path from 'node:path'
import { z } from 'zod'
import { loadEnv, type Env } from '@webreg/config'
import { prisma } from '@webreg/db'
import type { CatalogSource } from '@webreg/catalog'
import { classifyWorkerError } from './failure.js'
import { syncCatalogSource, type SourceSyncSummary } from './source-sync.js'
import { createCatalogSource } from './sources/factory.js'

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../../.env'))
} catch {
  // no .env file present — assume env vars are already set (e.g. in prod)
}

const USAGE = 'usage: add-term <id> <name> <startsAt> <endsAt> | sync <termId> | deactivate <termId>'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const isRealDate = (value: string): boolean => DATE_RE.test(value) && !Number.isNaN(new Date(value).getTime())

const AddTermArgsSchema = z
  .object({
    id: z.string().regex(/^[A-Z]{2}\d{2}$/, 'id must match /^[A-Z]{2}\\d{2}$/ (e.g. FA26)'),
    name: z.string().min(1, 'name must not be empty'),
    startsAt: z.string().regex(DATE_RE, 'startsAt must be an ISO date (YYYY-MM-DD)').refine(isRealDate, {
      message: 'startsAt is not a valid date'
    }),
    endsAt: z.string().regex(DATE_RE, 'endsAt must be an ISO date (YYYY-MM-DD)').refine(isRealDate, {
      message: 'endsAt is not a valid date'
    })
  })
  .refine((args) => new Date(args.endsAt).getTime() > new Date(args.startsAt).getTime(), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt']
  })

export type ParsedCommand =
  | { command: 'add-term'; id: string; name: string; startsAt: string; endsAt: string }
  | { command: 'sync'; termId: string }
  | { command: 'deactivate'; termId: string }
  | { command: 'error'; message: string }

/**
 * Parses and validates argv (post `node script command ...args`) into a discriminated union.
 * Pure/side-effect-free so it's unit-testable independent of Prisma/fetch.
 */
export function parseCliArgs(argv: string[]): ParsedCommand {
  const [command, ...args] = argv

  switch (command) {
    case 'add-term': {
      const [id, name, startsAt, endsAt] = args
      const result = AddTermArgsSchema.safeParse({ id, name, startsAt, endsAt })
      if (!result.success) {
        const details = result.error.issues.map((issue) => issue.message).join('; ')
        return { command: 'error', message: `invalid add-term args: ${details}\n${USAGE}` }
      }
      return { command: 'add-term', ...result.data }
    }

    case 'sync': {
      const [termId] = args
      if (!termId) return { command: 'error', message: `usage: sync <termId>\n${USAGE}` }
      return { command: 'sync', termId }
    }

    case 'deactivate': {
      const [termId] = args
      if (!termId) return { command: 'error', message: `usage: deactivate <termId>\n${USAGE}` }
      return { command: 'deactivate', termId }
    }

    default:
      return { command: 'error', message: `unknown command: ${String(command)}\n${USAGE}` }
  }
}

export async function runCliSync(
  termId: string,
  deps: {
    loadWorkerEnv?: () => Env
    createSource?: (env: Env) => CatalogSource
    sync?: typeof syncCatalogSource
  } = {}
): Promise<SourceSyncSummary> {
  const env = (deps.loadWorkerEnv ?? loadEnv)()
  const source = (deps.createSource ?? createCatalogSource)(env)
  const term = (await source.listTerms()).find(candidate => candidate.id === termId)
  if (!term) throw new Error('catalog_term_unavailable')
  const selected: CatalogSource = {
    kind: source.kind,
    knownTermIds: [term.id],
    listTerms: async () => [term],
    fetchDepartment: (selectedTermId, department) => {
      if (selectedTermId !== term.id) throw new Error('catalog_term_unavailable')
      return source.fetchDepartment(selectedTermId, department)
    }
  }
  return (deps.sync ?? syncCatalogSource)(selected)
}

export async function executeCliCommand(
  parsed: ParsedCommand,
  deps: {
    runSync?: typeof runCliSync
    log?: (message: string) => void
    error?: (message: string) => void
  } = {}
): Promise<0 | 1> {
  const log = deps.log ?? ((message: string) => console.log(message))
  const error = deps.error ?? ((message: string) => console.error(message))
  switch (parsed.command) {
    case 'error': {
      error(parsed.message)
      return 1
    }

    case 'add-term': {
      const { id, name, startsAt, endsAt } = parsed
      await prisma.term.upsert({
        where: { id },
        create: { id, name, active: true, startsAt: new Date(startsAt), endsAt: new Date(endsAt) },
        update: { name, active: true, startsAt: new Date(startsAt), endsAt: new Date(endsAt) }
      })
      log(`term ${id}: upserted (active)`)
      return 0
    }

    case 'sync': {
      const { termId } = parsed
      const synced = await (deps.runSync ?? runCliSync)(termId)
      const result = synced.terms[0]
      if (!result) throw new Error('catalog_sync_incomplete')
      log(`sync ${termId}: ok=${result.okDepts.length} failed=${result.failedDepts.length}`)
      if (result.failedDepts.length > 0) log(`failed depts: ${result.failedDepts.join(', ')}`)
      return 0
    }

    case 'deactivate': {
      const { termId } = parsed
      await prisma.term.update({ where: { id: termId }, data: { active: false } })
      log(`term ${termId}: deactivated`)
      return 0
    }
  }
}

async function main(): Promise<void> {
  const exitCode = await executeCliCommand(parseCliArgs(process.argv.slice(2)))
  if (exitCode !== 0) process.exitCode = exitCode
}

// Only run when executed directly (e.g. `tsx src/cli.ts ...`), not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      console.error(classifyWorkerError(error))
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
