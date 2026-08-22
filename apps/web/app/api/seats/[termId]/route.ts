import { prisma } from '@webreg/db'
import { z } from 'zod'
import { enforceIpRateLimit, RATE_LIMITS } from '../../../../lib/route-security'
import { MAX_IDENTIFIER_LENGTH } from '../../../../lib/bounded-json'

const MAX_SEAT_SECTION_IDS = 100

const SectionsQuery = z
  .string()
  .max(MAX_SEAT_SECTION_IDS * (MAX_IDENTIFIER_LENGTH + 1) - 1)
  .transform(s => [...new Set(s.split(','))])
  .pipe(z.array(z.string().min(1).max(MAX_IDENTIFIER_LENGTH)).min(1).max(MAX_SEAT_SECTION_IDS))

const TermId = z.string().min(1).max(MAX_IDENTIFIER_LENGTH)

export async function GET(req: Request, { params }: { params: Promise<{ termId: string }> }) {
  const limited = await enforceIpRateLimit(req, RATE_LIMITS.seats)
  if (limited) return limited

  const term = TermId.safeParse((await params).termId)
  const raw = new URL(req.url).searchParams.get('sections')
  const sectionIds = SectionsQuery.safeParse(raw ?? '')
  if (!term.success || !sectionIds.success) {
    return Response.json({ error: 'invalid sections param' }, { status: 400 })
  }

  const rows = await prisma.section.findMany({
    where: { id: { in: sectionIds.data }, course: { termId: term.data } },
    select: { id: true, available: true, waitlisted: true, capacity: true }
  })

  const sections = rows.map(r => ({ id: r.id, avail: r.available, wait: r.waitlisted, cap: r.capacity }))
  return Response.json({ sections })
}
