import { prisma, Prisma } from '@webreg/db'
import { z } from 'zod'
import { requireUser } from '../../../lib/require-user'
import { withSerializableRetry } from '../../../lib/with-serializable-retry'
import { enforceMutationOrigin, enforceUserRateLimit, RATE_LIMITS } from '../../../lib/route-security'
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_JSON_BODY_BYTES,
  MAX_SCHEDULES_PER_USER,
  readBoundedJson
} from '../../../lib/bounded-json'

class ScheduleLimitError extends Error {}
class InvalidTermError extends Error {}

const CreateBody = z.object({
  termId: z.string().min(1).max(MAX_IDENTIFIER_LENGTH),
  name: z.string().min(1).max(60)
})

const scheduleSelect = {
  id: true,
  termId: true,
  name: true,
  items: { select: { sectionId: true, status: true } }
} as const

export async function GET(req: Request) {
  let user
  try {
    user = await requireUser()
  } catch (res) {
    return res as Response
  }

  const term = new URL(req.url).searchParams.get('term')
  if (!term) {
    return Response.json({ error: 'missing term' }, { status: 400 })
  }

  const schedules = await prisma.schedule.findMany({
    where: { userId: user.id, termId: term },
    select: scheduleSelect,
    orderBy: { createdAt: 'asc' }
  })

  return Response.json({ schedules })
}

export async function POST(req: Request) {
  let user
  try {
    user = await requireUser()
  } catch (res) {
    return res as Response
  }

  const rejected = enforceMutationOrigin(req)
  if (rejected) return rejected

  const limited = await enforceUserRateLimit(user.id, RATE_LIMITS.scheduleMutation)
  if (limited) return limited

  const parsed = CreateBody.safeParse(await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }
  const { termId, name } = parsed.data

  try {
    const schedule = await withSerializableRetry(() =>
      prisma.$transaction(
        async tx => {
          const term = await tx.term.findUnique({ where: { id: termId }, select: { active: true } })
          if (!term?.active) {
            throw new InvalidTermError()
          }

          const count = await tx.schedule.count({ where: { userId: user.id } })
          if (count >= MAX_SCHEDULES_PER_USER) {
            throw new ScheduleLimitError()
          }
          return tx.schedule.create({ data: { userId: user.id, termId, name }, select: scheduleSelect })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    )
    return Response.json(schedule, { status: 201 })
  } catch (err) {
    if (err instanceof InvalidTermError) {
      return Response.json({ error: 'invalid term' }, { status: 400 })
    }
    if (err instanceof ScheduleLimitError) {
      return Response.json({ error: 'schedule limit reached' }, { status: 422 })
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return Response.json({ error: 'duplicate name' }, { status: 409 })
    }
    throw err
  }
}
