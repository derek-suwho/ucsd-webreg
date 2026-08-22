import { prisma } from '@webreg/db'
import { z } from 'zod'
import { MAX_JSON_BODY_BYTES, readBoundedJson } from '../../../lib/bounded-json'
import { requireUser } from '../../../lib/require-user'
import { enforceMutationOrigin, enforceUserRateLimit, RATE_LIMITS } from '../../../lib/route-security'

const DeleteAccountBody = z.object({ confirm: z.literal('DELETE') }).strict()

export async function DELETE(request: Request) {
  let user
  try {
    user = await requireUser()
  } catch (response) {
    return response as Response
  }

  const rejected = enforceMutationOrigin(request)
  if (rejected) return rejected

  const limited = await enforceUserRateLimit(user.id, RATE_LIMITS.accountDelete)
  if (limited) return limited

  const body = DeleteAccountBody.safeParse(
    await readBoundedJson(request, MAX_JSON_BODY_BYTES).catch(() => null)
  )
  if (!body.success) return Response.json({ error: 'invalid request' }, { status: 400 })

  try {
    await prisma.$transaction(async tx => {
      await tx.scheduleItem.deleteMany({ where: { schedule: { userId: user.id } } })
      await tx.schedule.deleteMany({ where: { userId: user.id } })
      const deleted = await tx.user.deleteMany({ where: { id: user.id } })
      if (deleted.count !== 1) throw new Error('account not found')
    })
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'unable to delete account' }, { status: 500 })
  }
}
