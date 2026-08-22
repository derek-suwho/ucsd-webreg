import { prisma, Prisma } from '@webreg/db'
import { z } from 'zod'
import { requireUser } from '../../../../lib/require-user'
import { enforceMutationOrigin, enforceUserRateLimit, RATE_LIMITS } from '../../../../lib/route-security'
import { MAX_JSON_BODY_BYTES, readBoundedJson } from '../../../../lib/bounded-json'

const RenameBody = z.object({ name: z.string().min(1).max(60) })

const scheduleSelect = {
  id: true,
  termId: true,
  name: true,
  items: { select: { sectionId: true, status: true } }
} as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = RenameBody.safeParse(await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const existing = await prisma.schedule.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  try {
    const schedule = await prisma.schedule.update({
      where: { id },
      data: { name: parsed.data.name },
      select: scheduleSelect
    })
    return Response.json(schedule)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return Response.json({ error: 'duplicate name' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const existing = await prisma.schedule.findUnique({ where: { id } })
  if (!existing || existing.userId !== user.id) {
    return Response.json({ error: 'not found' }, { status: 404 })
  }

  await prisma.$transaction([
    prisma.scheduleItem.deleteMany({ where: { scheduleId: id } }),
    prisma.schedule.delete({ where: { id } })
  ])

  return Response.json({ ok: true })
}
