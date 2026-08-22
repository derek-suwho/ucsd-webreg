import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@webreg/db'

let currentUserId: string | null = 'user-1'

vi.mock('../lib/auth', () => ({
  auth: () => Promise.resolve(currentUserId ? { user: { id: currentUserId } } : null)
}))

import { GET as listGET, POST as createPOST } from '../app/api/schedules/route'
import { PATCH as renamePATCH, DELETE as scheduleDELETE } from '../app/api/schedules/[id]/route'
import { PUT as itemsPUT } from '../app/api/schedules/[id]/items/route'
import { POST as copyPOST } from '../app/api/schedules/[id]/copy/route'
import { InMemoryRateLimitStore, setRateLimitStoreForTests } from '../lib/rate-limit'

const FA_SECTION_IDS = ['FA26:CSE:110:A01', 'FA26:CSE:110:A02', 'FA26:CSE:110:A03']
const WI_SECTION_ID = 'WI27:CSE:110:A01'

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
}

describe.skipIf(!process.env.DATABASE_URL)('schedules API routes', () => {
  beforeEach(async () => {
    setRateLimitStoreForTests(new InMemoryRateLimitStore(() => 0))
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ScheduleItem", "Schedule", "User", "Section", "Course", "Term" RESTART IDENTITY CASCADE'
    )
    await prisma.term.createMany({
      data: [
        { id: 'FA26', name: 'Fall 2026', active: true, startsAt: new Date('2026-09-24'), endsAt: new Date('2026-12-12') },
        { id: 'WI27', name: 'Winter 2027', active: true, startsAt: new Date('2027-01-04'), endsAt: new Date('2027-03-20') },
        { id: 'SP27', name: 'Spring 2027', active: false, startsAt: new Date('2027-03-29'), endsAt: new Date('2027-06-12') }
      ]
    })
    await prisma.course.createMany({
      data: [
        { id: 'FA26:CSE:110', termId: 'FA26', subject: 'CSE', number: '110', title: 'Software Engineering', unitsFrom: 4, unitsTo: 4, unitsInc: 1, restriction: [] },
        { id: 'WI27:CSE:110', termId: 'WI27', subject: 'CSE', number: '110', title: 'Software Engineering', unitsFrom: 4, unitsTo: 4, unitsInc: 1, restriction: [] }
      ]
    })
    await prisma.section.createMany({
      data: [
        ...Array.from({ length: 41 }, (_, index) => ({
          id: `FA26:CSE:110:A${String(index + 1).padStart(2, '0')}`,
          courseId: 'FA26:CSE:110',
          sectionCode: `A${String(index + 1).padStart(2, '0')}`,
          familyCode: 'A'
        })),
        { id: WI_SECTION_ID, courseId: 'WI27:CSE:110', sectionCode: 'A01', familyCode: 'A' }
      ]
    })
    await prisma.user.create({ data: { id: 'user-1', email: 'owner@example.com' } })
    await prisma.user.create({ data: { id: 'user-2', email: 'other@example.com' } })
    currentUserId = 'user-1'
  })

  afterAll(async () => {
    setRateLimitStoreForTests(undefined)
    await prisma.$disconnect()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('POST /api/schedules', () => {
    it('rejects a cross-origin mutation before creating a schedule', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv(
        'DATABASE_URL',
        'postgresql://web_runtime:secret@db.example.com:5432/webreg?sslmode=require&sslaccept=strict'
      )
      vi.stubEnv('APP_ORIGIN', 'https://webreg.example.test')
      vi.stubEnv('AUTH_URL', 'https://webreg.example.test')
      vi.stubEnv('NEXTAUTH_SECRET', 's'.repeat(32))
      vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client-id')
      vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-client-secret')
      vi.stubEnv('REDIS_URL', 'rediss://redis.example.test:6379')
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1')

      const res = await createPOST(new Request('https://webreg.example.test/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example.test' },
        body: JSON.stringify({ termId: 'FA26', name: 'Cross origin' })
      }))

      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'forbidden' })
      expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(0)
    })

    it('creates a schedule for the current user', async () => {
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'My Schedule' }))
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toMatchObject({ termId: 'FA26', name: 'My Schedule', items: [] })

      const row = await prisma.schedule.findUnique({ where: { id: body.id } })
      expect(row?.userId).toBe('user-1')
    })

    it('400s on malformed body', async () => {
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: '' }))
      expect(res.status).toBe(400)
    })

    it('400s for an invented term', async () => {
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'NOPE', name: 'Invented' }))
      expect(res.status).toBe(400)
    })

    it('400s for an inactive term', async () => {
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'SP27', name: 'Inactive' }))
      expect(res.status).toBe(400)
    })

    it('400s for a 129-character term ID', async () => {
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'T'.repeat(129), name: 'Long' }))
      expect(res.status).toBe(400)
    })

    it('409s on duplicate name within (user, term)', async () => {
      await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Dup' }))
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Dup' }))
      expect(res.status).toBe(409)
    })

    it('422s creating a 21st schedule when 20 are spread across terms', async () => {
      for (let i = 0; i < 20; i++) {
        const termId = i < 10 ? 'FA26' : 'WI27'
        const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId, name: `S${i}` }))
        expect(res.status).toBe(201)
      }
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S20' }))
      expect(res.status).toBe(422)
    })

    it('allows only one of two concurrent creates at the global limit', async () => {
      await prisma.schedule.createMany({
        data: Array.from({ length: 19 }, (_, index) => ({
          userId: 'user-1',
          termId: index < 10 ? 'FA26' : 'WI27',
          name: `Existing ${index}`
        }))
      })

      const responses = await Promise.all([
        createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Concurrent A' })),
        createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'WI27', name: 'Concurrent B' }))
      ])

      expect(responses.map(response => response.status).sort()).toEqual([201, 422])
      expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(20)
    })

    it('401s when unauthenticated', async () => {
      currentUserId = null
      const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'X' }))
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/schedules', () => {
    it('lists only the current user schedules with items', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Mine' }))
      const mine = await created.json()
      await itemsPUT(jsonReq(`http://localhost/api/schedules/${mine.id}/items`, 'PUT', { sectionIds: [FA_SECTION_IDS[0]] }), {
        params: Promise.resolve({ id: mine.id })
      })

      currentUserId = 'user-2'
      await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Theirs' }))
      currentUserId = 'user-1'

      const res = await listGET(new Request('http://localhost/api/schedules?term=FA26'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.schedules).toHaveLength(1)
      expect(body.schedules[0]).toMatchObject({
        id: mine.id,
        termId: 'FA26',
        name: 'Mine',
        items: [{ sectionId: 'FA26:CSE:110:A01', status: 'planned' }]
      })
    })

    it('401s when unauthenticated', async () => {
      currentUserId = null
      const res = await listGET(new Request('http://localhost/api/schedules?term=FA26'))
      expect(res.status).toBe(401)
    })
  })

  describe('PATCH /api/schedules/[id]', () => {
    it('renames a schedule owned by the current user', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Old' }))
      const { id } = await created.json()

      const res = await renamePATCH(jsonReq(`http://localhost/api/schedules/${id}`, 'PATCH', { name: 'New' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.name).toBe('New')
    })

    it('400s on malformed body', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Old' }))
      const { id } = await created.json()

      const res = await renamePATCH(jsonReq(`http://localhost/api/schedules/${id}`, 'PATCH', { name: '' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(400)
    })

    it('returns the stable invalid-body response for an oversized rename payload', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Old' }))
      const { id } = await created.json()
      const req = jsonReq(`http://localhost/api/schedules/${id}`, 'PATCH', {
        name: 'New',
        padding: 'x'.repeat(16 * 1024)
      })

      const res = await renamePATCH(req, { params: Promise.resolve({ id }) })

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'invalid body' })
    })

    it('404s renaming another user schedule', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Old' }))
      const { id } = await created.json()

      currentUserId = 'user-2'
      const res = await renamePATCH(jsonReq(`http://localhost/api/schedules/${id}`, 'PATCH', { name: 'New' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(404)
    })

    it('401s when unauthenticated', async () => {
      currentUserId = null
      const res = await renamePATCH(jsonReq('http://localhost/api/schedules/nope', 'PATCH', { name: 'New' }), {
        params: Promise.resolve({ id: 'nope' })
      })
      expect(res.status).toBe(401)
    })
  })

  describe('PUT /api/schedules/[id]/items', () => {
    it('replaces all items with status planned', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()

      await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: FA_SECTION_IDS.slice(0, 2) }), {
        params: Promise.resolve({ id })
      })
      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: [FA_SECTION_IDS[2]] }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toEqual([{ sectionId: FA_SECTION_IDS[2], status: 'planned' }])
    })

    it('accepts at most 40 distinct section IDs after deduplication', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()
      const sectionIds = [
        ...Array.from({ length: 40 }, (_, index) => `FA26:CSE:110:A${String(index + 1).padStart(2, '0')}`),
        FA_SECTION_IDS[0]
      ]

      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(200)
      expect((await res.json()).items).toHaveLength(40)
    })

    it('400s for 41 distinct valid sections without mutating existing items', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()
      await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: [FA_SECTION_IDS[0]] }), {
        params: Promise.resolve({ id })
      })
      const sectionIds = Array.from(
        { length: 41 },
        (_, index) => `FA26:CSE:110:A${String(index + 1).padStart(2, '0')}`
      )

      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds }), {
        params: Promise.resolve({ id })
      })

      expect(res.status).toBe(400)
      expect(await prisma.scheduleItem.findMany({ where: { scheduleId: id }, select: { sectionId: true } }))
        .toEqual([{ sectionId: FA_SECTION_IDS[0] }])
    })

    it('400s for a nonexistent section without deleting existing items', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()
      await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: [FA_SECTION_IDS[0]] }), {
        params: Promise.resolve({ id })
      })

      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: ['FA26:CSE:110:NOPE'] }), {
        params: Promise.resolve({ id })
      })

      expect(res.status).toBe(400)
      expect(await prisma.scheduleItem.findMany({ where: { scheduleId: id }, select: { sectionId: true } }))
        .toEqual([{ sectionId: FA_SECTION_IDS[0] }])
    })

    it('400s for a section from another term', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()
      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: [WI_SECTION_ID] }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(400)
    })

    it('400s for a 129-character section ID', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()
      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: ['S'.repeat(129)] }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(400)
    })

    it('404s replacing items on another user schedule', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()

      currentUserId = 'user-2'
      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: [FA_SECTION_IDS[0]] }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(404)
    })

    it('401s when unauthenticated', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'S' }))
      const { id } = await created.json()

      currentUserId = null
      const res = await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: ['A'] }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/schedules/[id]/copy', () => {
    it('duplicates a schedule and its items', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Orig' }))
      const { id } = await created.json()
      await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: FA_SECTION_IDS.slice(0, 2) }), {
        params: Promise.resolve({ id })
      })

      const res = await copyPOST(jsonReq(`http://localhost/api/schedules/${id}/copy`, 'POST', { name: 'Copy' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.id).not.toBe(id)
      expect(body.name).toBe('Copy')
      expect(body.items.map((i: { sectionId: string }) => i.sectionId).sort()).toEqual(FA_SECTION_IDS.slice(0, 2))
    })

    it('404s copying another user schedule', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Orig' }))
      const { id } = await created.json()

      currentUserId = 'user-2'
      const res = await copyPOST(jsonReq(`http://localhost/api/schedules/${id}/copy`, 'POST', { name: 'Copy' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(404)
    })

    it('400s copying a schedule whose term is inactive', async () => {
      const source = await prisma.schedule.create({
        data: { userId: 'user-1', termId: 'SP27', name: 'Inactive source' }
      })

      const res = await copyPOST(jsonReq(`http://localhost/api/schedules/${source.id}/copy`, 'POST', { name: 'Copy' }), {
        params: Promise.resolve({ id: source.id })
      })

      expect(res.status).toBe(400)
      expect(await prisma.schedule.count({ where: { userId: 'user-1' } })).toBe(1)
    })

    it('422s copying when the user already has 20 schedules across terms', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Orig' }))
      const { id } = await created.json()

      for (let i = 0; i < 19; i++) {
        const termId = i < 9 ? 'FA26' : 'WI27'
        const res = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId, name: `S${i}` }))
        expect(res.status).toBe(201)
      }

      const res = await copyPOST(jsonReq(`http://localhost/api/schedules/${id}/copy`, 'POST', { name: 'Copy' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(422)
    })

    it('401s when unauthenticated', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Orig' }))
      const { id } = await created.json()

      currentUserId = null
      const res = await copyPOST(jsonReq(`http://localhost/api/schedules/${id}/copy`, 'POST', { name: 'Copy' }), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(401)
    })
  })

  describe('DELETE /api/schedules/[id]', () => {
    it('deletes a schedule and its items', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Gone' }))
      const { id } = await created.json()
      await itemsPUT(jsonReq(`http://localhost/api/schedules/${id}/items`, 'PUT', { sectionIds: [FA_SECTION_IDS[0]] }), {
        params: Promise.resolve({ id })
      })

      const res = await scheduleDELETE(jsonReq(`http://localhost/api/schedules/${id}`, 'DELETE'), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(200)

      const row = await prisma.schedule.findUnique({ where: { id } })
      expect(row).toBeNull()
      const items = await prisma.scheduleItem.findMany({ where: { scheduleId: id } })
      expect(items).toHaveLength(0)
    })

    it('404s deleting another user schedule', async () => {
      const created = await createPOST(jsonReq('http://localhost/api/schedules', 'POST', { termId: 'FA26', name: 'Gone' }))
      const { id } = await created.json()

      currentUserId = 'user-2'
      const res = await scheduleDELETE(jsonReq(`http://localhost/api/schedules/${id}`, 'DELETE'), {
        params: Promise.resolve({ id })
      })
      expect(res.status).toBe(404)
    })

    it('401s when unauthenticated', async () => {
      currentUserId = null
      const res = await scheduleDELETE(jsonReq('http://localhost/api/schedules/nope', 'DELETE'), {
        params: Promise.resolve({ id: 'nope' })
      })
      expect(res.status).toBe(401)
    })
  })
})
