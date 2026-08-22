import { prisma, Prisma } from '@webreg/db'
import { z } from 'zod'
import { requireUser } from '../../../../../lib/require-user'
import { withSerializableRetry } from '../../../../../lib/with-serializable-retry'
import { enforceMutationOrigin, enforceUserRateLimit, RATE_LIMITS } from '../../../../../lib/route-security'
import {
  MAX_JSON_BODY_BYTES,
  MAX_SCHEDULES_PER_USER,
  readBoundedJson
} from '../../../../../lib/bounded-json'

class ScheduleLimitError extends Error {}
class ScheduleNotFoundError extends Error {}
class InactiveTermError extends Error {}

const CopyBody = z.object({ name: z.string().min(1).max(60) })

const scheduleSelect = {
  id: true,
  termId: true,
  name: true,
  items: { select: { sectionId: true, status: true } }
} as const

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const parsed = CopyBody.safeParse(await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  try {
    const copy = await withSerializableRetry(() =>
      prisma.$transaction(
        async tx => {
          const source = await tx.schedule.findUnique({
            where: { id },
            include: { items: true, term: { select: { active: true } } }
          })
          if (!source || source.userId !== user.id) {
            throw new ScheduleNotFoundError()
          }
          if (!source.term.active) {
            throw new InactiveTermError()
          }

          const count = await tx.schedule.count({ where: { userId: user.id } })
          if (count >= MAX_SCHEDULES_PER_USER) {
            throw new ScheduleLimitError()
          }

          const created = await tx.schedule.create({
            data: { userId: user.id, termId: source.termId, name: parsed.data.name }
          })
          if (source.items.length) {
            await tx.scheduleItem.createMany({
              data: source.items.map(i => ({ scheduleId: created.id, sectionId: i.sectionId, status: i.status }))
            })
          }
          return tx.schedule.findUniqueOrThrow({ where: { id: created.id }, select: scheduleSelect })
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    )
    return Response.json(copy, { status: 201 })
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) {
      return Response.json({ error: 'not found' }, { status: 404 })
    }
    if (err instanceof InactiveTermError) {
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
