import { prisma } from '@webreg/db'
import { z } from 'zod'
import { requireUser } from '../../../../../lib/require-user'
import { enforceMutationOrigin, enforceUserRateLimit, RATE_LIMITS } from '../../../../../lib/route-security'
import {
  MAX_IDENTIFIER_LENGTH,
  MAX_JSON_BODY_BYTES,
  MAX_SCHEDULE_ITEMS,
  readBoundedJson
} from '../../../../../lib/bounded-json'

const ItemsBody = z.object({
  sectionIds: z.array(z.string().min(1).max(MAX_IDENTIFIER_LENGTH))
})

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = ItemsBody.safeParse(await readBoundedJson(req, MAX_JSON_BODY_BYTES).catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const sectionIds = [...new Set(parsed.data.sectionIds)]
  if (sectionIds.length > MAX_SCHEDULE_ITEMS) {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  const result = await prisma.$transaction(async tx => {
    const existing = await tx.schedule.findUnique({ where: { id } })
    if (!existing || existing.userId !== user.id) {
      return { kind: 'not-found' } as const
    }

    const sections = await tx.section.findMany({
      where: { id: { in: sectionIds } },
      select: { id: true, course: { select: { termId: true } } }
    })
    if (sections.length !== sectionIds.length || sections.some(section => section.course.termId !== existing.termId)) {
      return { kind: 'invalid-sections' } as const
    }

    await tx.scheduleItem.deleteMany({ where: { scheduleId: id } })
    if (sectionIds.length) {
      await tx.scheduleItem.createMany({
        data: sectionIds.map(sectionId => ({ scheduleId: id, sectionId, status: 'planned' }))
      })
    }
    const items = await tx.scheduleItem.findMany({
      where: { scheduleId: id },
      select: { sectionId: true, status: true }
    })
    return { kind: 'ok', items } as const
  })

  if (result.kind === 'not-found') {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  if (result.kind === 'invalid-sections') {
    return Response.json({ error: 'invalid sections' }, { status: 400 })
  }
  return Response.json({ id, items: result.items })
}
