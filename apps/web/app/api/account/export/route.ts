import { prisma } from '@webreg/db'
import { z } from 'zod'
import { MAX_IDENTIFIER_LENGTH, MAX_SCHEDULE_ITEMS, MAX_SCHEDULES_PER_USER } from '../../../../lib/bounded-json'
import { requireUser } from '../../../../lib/require-user'
import { enforceUserRateLimit, RATE_LIMITS } from '../../../../lib/route-security'

const MAX_EXPORT_BYTES = 256 * 1024

const ExportSchedule = z.object({
  termId: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
  name: z.string().trim().min(1).max(60),
  sectionIds: z.array(z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH)).max(MAX_SCHEDULE_ITEMS)
}).strict().superRefine((schedule, ctx) => {
  if (new Set(schedule.sectionIds).size !== schedule.sectionIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sectionIds'], message: 'duplicate section ID' })
  }
})

const ExportData = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().datetime({ offset: true }),
  schedules: z.array(ExportSchedule).max(MAX_SCHEDULES_PER_USER)
}).strict()

function exportError() {
  return Response.json({ error: 'unable to export account data' }, { status: 500 })
}

export async function GET() {
  let user
  try {
    user = await requireUser()
  } catch (response) {
    return response as Response
  }

  const limited = await enforceUserRateLimit(user.id, RATE_LIMITS.accountExport)
  if (limited) return limited

  try {
    const rows = await prisma.schedule.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_SCHEDULES_PER_USER + 1,
      select: {
        termId: true,
        name: true,
        items: {
          orderBy: { sectionId: 'asc' },
          take: MAX_SCHEDULE_ITEMS + 1,
          select: { sectionId: true }
        }
      }
    })
    const parsed = ExportData.safeParse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      schedules: rows.map(schedule => ({
        termId: schedule.termId,
        name: schedule.name,
        sectionIds: schedule.items.map(item => item.sectionId)
      }))
    })
    if (!parsed.success) return exportError()

    const json = JSON.stringify(parsed.data)
    if (Buffer.byteLength(json, 'utf8') > MAX_EXPORT_BYTES) return exportError()
    const date = parsed.data.generatedAt.slice(0, 10)
    return new Response(json, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="course-planner-schedules-${date}.json"`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    })
  } catch {
    return exportError()
  }
}
