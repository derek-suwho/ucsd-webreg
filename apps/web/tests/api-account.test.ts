import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@webreg/db'

let currentUserId: string | null = 'user-1'

vi.mock('../lib/auth', () => ({
  auth: () => Promise.resolve(currentUserId ? { user: { id: currentUserId } } : null)
}))

import { GET as exportGET } from '../app/api/account/export/route'
import { DELETE as accountDELETE } from '../app/api/account/route'
import {
  InMemoryRateLimitStore,
  setRateLimitStoreForTests,
  type RateLimitStore
} from '../lib/rate-limit'

const SECTION_IDS = ['FA26:CSE:110:A01', 'FA26:CSE:110:A02']

const overLimitStore: RateLimitStore = {
  increment: async () => ({ count: 999, ttlSeconds: 60 })
}

function productionEnv() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv(
    'DATABASE_URL',
    'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'
  )
  vi.stubEnv('APP_ORIGIN', 'https://planner.example.test')
  vi.stubEnv('NEXTAUTH_SECRET', 's'.repeat(32))
  vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
  vi.stubEnv('REDIS_URL', 'rediss://redis.example.test:6379')
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
}

function accountDeleteRequest(body: unknown = { confirm: 'DELETE' }): Request {
  return new Request('http://localhost/api/account', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

async function createOwnedSchedule(userId = 'user-1', name = 'Primary') {
  return prisma.schedule.create({
    data: {
      userId,
      termId: 'FA26',
      name,
      items: {
        create: SECTION_IDS.map(sectionId => ({ sectionId, status: 'planned' }))
      }
    }
  })
}

describe.skipIf(!process.env.DATABASE_URL)('account API routes', () => {
  beforeEach(async () => {
    setRateLimitStoreForTests(new InMemoryRateLimitStore(() => 0))
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "AccountDeleteBlock"')
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ScheduleItem", "Schedule", "User", "Section", "Course", "Term" RESTART IDENTITY CASCADE'
    )
    await prisma.term.create({
      data: {
        id: 'FA26',
        name: 'Fall 2026',
        active: true,
        startsAt: new Date('2026-09-24'),
        endsAt: new Date('2026-12-12')
      }
    })
    await prisma.course.create({
      data: {
        id: 'FA26:CSE:110',
        termId: 'FA26',
        subject: 'CSE',
        number: '110',
        title: 'Software Engineering',
        unitsFrom: 4,
        unitsTo: 4,
        unitsInc: 1,
        restriction: []
      }
    })
    await prisma.section.createMany({
      data: SECTION_IDS.map((id, index) => ({
        id,
        courseId: 'FA26:CSE:110',
        sectionCode: `A0${index + 1}`,
        familyCode: 'A'
      }))
    })
    await prisma.user.createMany({
      data: [
        { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
        { id: 'user-2', email: 'other@example.com', name: 'Other' }
      ]
    })
    currentUserId = 'user-1'
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    setRateLimitStoreForTests(undefined)
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "AccountDeleteBlock"')
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('exports only the current user portable schedules with no profile or internal fields', async () => {
    await createOwnedSchedule('user-1', 'Primary')
    await createOwnedSchedule('user-2', 'Private')

    const response = await exportGET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="course-planner-schedules-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(body).toEqual({
      schemaVersion: 1,
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      schedules: [{ termId: 'FA26', name: 'Primary', sectionIds: SECTION_IDS }]
    })
    expect(JSON.stringify(body)).not.toMatch(/owner@example|user-1|status|createdAt|updatedAt|"id"/)
  })

  it('rejects unauthenticated exports and bounded-data violations', async () => {
    currentUserId = null
    expect((await exportGET()).status).toBe(401)

    currentUserId = 'user-1'
    await prisma.schedule.createMany({
      data: Array.from({ length: 21 }, (_, index) => ({
        userId: 'user-1', termId: 'FA26', name: `Plan ${index}`
      }))
    })
    const response = await exportGET()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'unable to export account data' })
  })

  it('rate-limits exports before reading account data', async () => {
    await createOwnedSchedule()
    setRateLimitStoreForTests(overLimitStore)

    const response = await exportGET()

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
  })

  it.each([undefined, 'https://attacker.example.test', 'https://planner.example.test.evil.test'])(
    'rejects a non-exact production deletion origin: %s',
    async origin => {
      productionEnv()
      await createOwnedSchedule()
      const response = await accountDELETE(new Request('https://planner.example.test/api/account', {
        method: 'DELETE',
        headers: origin ? { Origin: origin } : undefined
      }))

      expect(response.status).toBe(403)
      expect(await prisma.user.findUnique({ where: { id: 'user-1' } })).not.toBeNull()
      expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(1)
    }
  )

  it('deletes owned items, schedules, then the user while preserving other accounts', async () => {
    await createOwnedSchedule('user-1', 'Mine')
    await createOwnedSchedule('user-2', 'Theirs')

    const response = await accountDELETE(accountDeleteRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(await prisma.user.findUnique({ where: { id: 'user-1' } })).toBeNull()
    expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(0)
    expect(await prisma.scheduleItem.count({ where: { schedule: { userId: 'user-2' } } })).toBe(2)
    expect(await prisma.user.findUnique({ where: { id: 'user-2' } })).not.toBeNull()
  })

  it('rolls back item and schedule deletion when the user delete fails', async () => {
    const schedule = await createOwnedSchedule()
    await prisma.$executeRawUnsafe(
      'CREATE TABLE "AccountDeleteBlock" ("userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE RESTRICT)'
    )
    await prisma.$executeRawUnsafe('INSERT INTO "AccountDeleteBlock" ("userId") VALUES (\'user-1\')')

    const response = await accountDELETE(accountDeleteRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'unable to delete account' })
    expect(await prisma.user.findUnique({ where: { id: 'user-1' } })).not.toBeNull()
    expect(await prisma.schedule.findUnique({ where: { id: schedule.id } })).not.toBeNull()
    expect(await prisma.scheduleItem.count({ where: { scheduleId: schedule.id } })).toBe(2)
  })

  it('rejects unauthenticated or rate-limited deletion without mutation', async () => {
    await createOwnedSchedule()
    currentUserId = null
    expect((await accountDELETE(accountDeleteRequest())).status).toBe(401)

    currentUserId = 'user-1'
    setRateLimitStoreForTests(overLimitStore)
    expect((await accountDELETE(accountDeleteRequest())).status).toBe(429)
    expect(await prisma.user.findUnique({ where: { id: 'user-1' } })).not.toBeNull()
    expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(1)
  })

  it('rejects missing, wrong, extra-key, and oversized confirmations before deletion', async () => {
    await createOwnedSchedule()
    const requests = [
      new Request('http://localhost/api/account', { method: 'DELETE' }),
      accountDeleteRequest({ confirm: 'delete' }),
      accountDeleteRequest({ confirm: 'DELETE', extra: true }),
      new Request('http://localhost/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE', padding: 'x'.repeat(17 * 1024) })
      })
    ]

    for (const request of requests) {
      setRateLimitStoreForTests(new InMemoryRateLimitStore(() => 0))
      const response = await accountDELETE(request)
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'invalid request' })
    }
    expect(await prisma.user.findUnique({ where: { id: 'user-1' } })).not.toBeNull()
    expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(1)
  })
})
