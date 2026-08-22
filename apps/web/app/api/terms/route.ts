import { prisma } from '@webreg/db'
import { enforceIpRateLimit, RATE_LIMITS } from '../../../lib/route-security'

export async function GET(request: Request) {
  const limited = await enforceIpRateLimit(request, RATE_LIMITS.terms)
  if (limited) return limited

  const terms = await prisma.term.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, name: true, active: true, startsAt: true, endsAt: true }
  })
  return Response.json({ terms })
}
