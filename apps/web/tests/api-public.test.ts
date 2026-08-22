import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@webreg/db'
import { GET as healthGET } from '../app/api/health/route'
import { GET as termsGET } from '../app/api/terms/route'
import { GET as catalogGET } from '../app/api/catalog/[termId]/route'
import { GET as seatsGET } from '../app/api/seats/[termId]/route'
import { InMemoryRateLimitStore, setRateLimitStoreForTests } from '../lib/rate-limit'

function publicRequest(path: string) {
  return new Request(`http://localhost${path}`)
}

describe.skipIf(!process.env.DATABASE_URL)('public API routes', () => {
  beforeEach(async () => {
    setRateLimitStoreForTests(new InMemoryRateLimitStore(() => 0))
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "SeatSnapshot", "Exam", "Meeting", "Section", "Course", "CatalogSnapshot", "ImportRun", "Term" RESTART IDENTITY CASCADE'
    )
    await prisma.term.create({
      data: {
        id: 'FA26',
        name: 'Fall Quarter 2026',
        active: true,
        startsAt: new Date('2026-09-24'),
        endsAt: new Date('2026-12-04')
      }
    })
    await prisma.term.create({
      data: {
        id: 'WI26',
        name: 'Winter Quarter 2026',
        active: false,
        startsAt: new Date('2026-01-05'),
        endsAt: new Date('2026-03-13')
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    setRateLimitStoreForTests(undefined)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('GET /api/terms', () => {
    it('returns all terms ordered by id', async () => {
      const res = await termsGET(publicRequest('/api/terms'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.terms.map((t: { id: string }) => t.id)).toEqual(['FA26', 'WI26'])
      expect(body.terms[0]).toMatchObject({ id: 'FA26', name: 'Fall Quarter 2026', active: true })
    })
  })

  describe('GET /api/health', () => {
    beforeEach(async () => {
      await prisma.catalogSnapshot.create({ data: {
        termId: 'FA26', version: 1, generatedAt: new Date('2026-07-20T11:05:00Z'),
        data: {
          termId: 'FA26', version: 1, generatedAt: '2026-07-20T11:05:00Z', courses: {}, sections: {},
          provenance: { sourceKind: 'legacy-soc', mode: 'live', sourceGeneratedAt: '2026-07-20T11:00:00Z' }
        }
      } })
    })
    it('returns coarse ok=true for a fresh successful latest full run', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-20T11:00:00Z'),
          finishedAt: new Date('2026-07-20T11:05:00Z'),
          okDepts: ['CSE'],
          failedDepts: [],
          error: null
        }
      })

      const res = await healthGET(publicRequest('/api/health'))
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({ ok: true })
    })

    it('returns ok=false when the latest full run has a fatal error', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-20T11:00:00Z'),
          finishedAt: new Date('2026-07-20T11:05:00Z'),
          okDepts: ['CSE'],
          failedDepts: [],
          error: 'department_list_failed'
        }
      })

      const res = await healthGET(publicRequest('/api/health'))
      await expect(res.json()).resolves.toEqual({ ok: false })
    })

    it('returns ok=false when the latest full run has failed departments', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-20T11:00:00Z'),
          finishedAt: new Date('2026-07-20T11:05:00Z'),
          okDepts: ['CSE'],
          failedDepts: ['MATH'],
          error: null
        }
      })

      const res = await healthGET(publicRequest('/api/health'))
      await expect(res.json()).resolves.toEqual({ ok: false })
    })

    it.each([
      ['failed', new Date('2026-07-20T11:05:00Z'), 'source unavailable'],
      ['unfinished', null, null]
    ])('uses a newer %s run instead of an older healthy run', async (_state, finishedAt, error) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-20T10:00:00Z'),
          finishedAt: new Date('2026-07-20T10:05:00Z'),
          okDepts: ['CSE'],
          failedDepts: [],
          error: null
        }
      })
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-20T11:00:00Z'),
          finishedAt,
          okDepts: [],
          failedDepts: [],
          error
        }
      })

      const res = await healthGET(publicRequest('/api/health'))
      await expect(res.json()).resolves.toEqual({ ok: false })
    })

    it('returns ok=false when the latest full run is unfinished', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-20T11:00:00Z'),
          finishedAt: null,
          okDepts: [],
          failedDepts: []
        }
      })

      const res = await healthGET(publicRequest('/api/health'))
      await expect(res.json()).resolves.toEqual({ ok: false })
    })

    it('returns ok=false when the latest full run is stale', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
      await prisma.importRun.create({
        data: {
          termId: 'FA26',
          kind: 'full',
          startedAt: new Date('2026-07-19T23:00:00Z'),
          finishedAt: new Date('2026-07-19T23:05:00Z'),
          okDepts: ['CSE'],
          failedDepts: [],
          error: null
        }
      })

      const res = await healthGET(publicRequest('/api/health'))
      await expect(res.json()).resolves.toEqual({ ok: false })
    })

    it('keeps an aged one-shot demo snapshot healthy', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
      await prisma.catalogSnapshot.update({ where: { termId: 'FA26' }, data: { data: {
        termId: 'FA26', version: 1, generatedAt: '2026-07-01T00:00:00Z', courses: {}, sections: {},
        provenance: { sourceKind: 'fixture', mode: 'demo', sourceGeneratedAt: '2026-07-01T00:00:00Z' }
      } } })
      await prisma.importRun.create({ data: {
        termId: 'FA26', kind: 'full', startedAt: new Date('2026-07-01T00:00:00Z'),
        finishedAt: new Date('2026-07-01T00:05:00Z'), okDepts: ['DEMO'], failedDepts: []
      } })
      await expect((await healthGET(publicRequest('/api/health'))).json()).resolves.toEqual({ ok: true })
    })

    it.each(['missing snapshot', 'malformed provenance', 'zero departments'])(
      'returns ok=false for %s', async state => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-07-20T12:00:00Z'))
        if (state === 'missing snapshot') await prisma.catalogSnapshot.delete({ where: { termId: 'FA26' } })
        if (state === 'malformed provenance') {
          await prisma.catalogSnapshot.update({ where: { termId: 'FA26' }, data: { data: { provenance: 'bad' } } })
        }
        await prisma.importRun.create({ data: {
          termId: 'FA26', kind: 'full', startedAt: new Date('2026-07-20T11:00:00Z'),
          finishedAt: new Date('2026-07-20T11:05:00Z'),
          okDepts: state === 'zero departments' ? [] : ['CSE'], failedDepts: []
        } })
        await expect((await healthGET(publicRequest('/api/health'))).json()).resolves.toEqual({ ok: false })
      }
    )
  })

  describe('GET /api/catalog/[termId]', () => {
    beforeEach(async () => {
      await prisma.catalogSnapshot.create({
        data: {
          termId: 'FA26',
          version: 3,
          generatedAt: new Date('2026-07-20T00:00:00Z'),
          data: { termId: 'FA26', version: 3, generatedAt: '2026-07-20T00:00:00Z', courses: {}, sections: {} }
        }
      })
    })

    it('returns snapshot data with ETag and Cache-Control headers', async () => {
      const req = new Request('http://localhost/api/catalog/FA26')
      const res = await catalogGET(req, { params: Promise.resolve({ termId: 'FA26' }) })
      expect(res.status).toBe(200)
      expect(res.headers.get('ETag')).toBe('"v3"')
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60')
      const body = await res.json()
      expect(body.version).toBe(3)
    })

    it('returns 304 with empty body when If-None-Match matches', async () => {
      const req = new Request('http://localhost/api/catalog/FA26', {
        headers: { 'If-None-Match': '"v3"' }
      })
      const res = await catalogGET(req, { params: Promise.resolve({ termId: 'FA26' }) })
      expect(res.status).toBe(304)
      const text = await res.text()
      expect(text).toBe('')
    })

    it('returns 404 for unknown term', async () => {
      const req = new Request('http://localhost/api/catalog/ZZ99')
      const res = await catalogGET(req, { params: Promise.resolve({ termId: 'ZZ99' }) })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/seats/[termId]', () => {
    beforeEach(async () => {
      await prisma.course.create({
        data: {
          id: 'FA26:CSE:110',
          termId: 'FA26',
          subject: 'CSE',
          number: '110',
          title: 'Software Engineering',
          unitsFrom: 4,
          unitsTo: 4,
          unitsInc: 0,
          restriction: []
        }
      })
      await prisma.section.create({
        data: {
          id: 'FA26:CSE:110:A01',
          courseId: 'FA26:CSE:110',
          sectionCode: 'A01',
          familyCode: 'A',
          registrationNumber: 123456,
          capacity: 30,
          available: 10,
          waitlisted: 0
        }
      })
    })

    it('returns seat data for requested section ids', async () => {
      const req = new Request('http://localhost/api/seats/FA26?sections=FA26:CSE:110:A01')
      const res = await seatsGET(req, { params: Promise.resolve({ termId: 'FA26' }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.sections).toEqual([{ id: 'FA26:CSE:110:A01', avail: 10, wait: 0, cap: 30 }])
    })

    it('400s when sections param is missing', async () => {
      const req = new Request('http://localhost/api/seats/FA26')
      const res = await seatsGET(req, { params: Promise.resolve({ termId: 'FA26' }) })
      expect(res.status).toBe(400)
    })

    it('400s when more than 100 section ids are requested', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `FA26:CSE:110:A${i}`).join(',')
      const req = new Request(`http://localhost/api/seats/FA26?sections=${ids}`)
      const res = await seatsGET(req, { params: Promise.resolve({ termId: 'FA26' }) })
      expect(res.status).toBe(400)
    })

    it('omits requested sections belonging to another term', async () => {
      await prisma.course.create({
        data: {
          id: 'WI26:CSE:110',
          termId: 'WI26',
          subject: 'CSE',
          number: '110',
          title: 'Software Engineering',
          unitsFrom: 4,
          unitsTo: 4,
          unitsInc: 0,
          restriction: []
        }
      })
      await prisma.section.create({
        data: {
          id: 'WI26:CSE:110:A01',
          courseId: 'WI26:CSE:110',
          sectionCode: 'A01',
          familyCode: 'A',
          capacity: 30,
          available: 10,
          waitlisted: 0
        }
      })

      const req = new Request('http://localhost/api/seats/FA26?sections=FA26:CSE:110:A01,WI26:CSE:110:A01')
      const res = await seatsGET(req, { params: Promise.resolve({ termId: 'FA26' }) })

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        sections: [{ id: 'FA26:CSE:110:A01', avail: 10, wait: 0, cap: 30 }]
      })
    })
  })
})
