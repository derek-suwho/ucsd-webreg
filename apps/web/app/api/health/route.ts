import { prisma } from '@webreg/db'
import { catalogProvenanceSchema } from '@webreg/catalog'
import { enforceIpRateLimit, RATE_LIMITS } from '../../../lib/route-security'

// Full syncs run every six hours; allow one missed run before reporting unhealthy.
const MAX_FULL_SYNC_AGE_MS = 12 * 60 * 60 * 1000

export async function GET(request: Request) {
  const limited = await enforceIpRateLimit(request, RATE_LIMITS.health)
  if (limited) return limited

  const activeTerms = await prisma.term.findMany({ where: { active: true }, select: { id: true } })
  const states = await Promise.all(
    activeTerms.map(({ id: termId }) =>
      Promise.all([
        prisma.importRun.findFirst({ where: { termId, kind: 'full' }, orderBy: { startedAt: 'desc' } }),
        prisma.catalogSnapshot.findUnique({ where: { termId }, select: { data: true } })
      ])
    )
  )
  const now = Date.now()
  const ok = activeTerms.length > 0 && states.every(([run, snapshot]) => {
    if (!snapshot || !run?.finishedAt || run.error !== null || run.failedDepts.length > 0 || run.okDepts.length === 0) {
      return false
    }
    const data = snapshot.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false
    const provenance = catalogProvenanceSchema.safeParse((data as Record<string, unknown>).provenance)
    if (!provenance.success) return false
    if (provenance.data.mode === 'demo' || provenance.data.sourceKind === 'fixture') return true
    const ageMs = now - run.finishedAt.getTime()
    return ageMs >= 0 && ageMs <= MAX_FULL_SYNC_AGE_MS
  })

  return Response.json({ ok })
}
