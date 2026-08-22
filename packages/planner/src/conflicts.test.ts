import { describe, it, expect } from 'vitest'
import type { CatalogData, CatalogSection } from '@webreg/catalog'
import { findConflicts } from './conflicts.js'

function section(id: string, overrides: Partial<CatalogSection> = {}): CatalogSection {
  return {
    id, courseId: 'CSE110', code: 'A00', family: 'LE',
    regNum: null, instructor: null, cap: null, avail: null, wait: null, cancelled: false,
    meetings: [],
    exams: [],
    ...overrides
  }
}

function catalog(sections: CatalogSection[]): CatalogData {
  return {
    termId: 'FA26', version: 1, generatedAt: '2026-01-01T00:00:00Z',
    courses: {},
    sections: Object.fromEntries(sections.map(s => [s.id, s]))
  }
}

describe('findConflicts', () => {
  it('flags overlapping meetings that share exactly one day token', () => {
    const a = section('a', { meetings: [{ type: 'LE', days: 'MW', start: 600, end: 650, bldg: null, room: null }] })
    const b = section('b', { meetings: [{ type: 'LE', days: 'WF', start: 620, end: 670, bldg: null, room: null }] })
    const conflicts = findConflicts(['a', 'b'], catalog([a, b]))
    expect(conflicts).toEqual([{ a: 'a', b: 'b', kind: 'meeting', day: 'W' }])
  })

  it('does not flag adjacent meetings (end === start)', () => {
    const a = section('a', { meetings: [{ type: 'LE', days: 'MWF', start: 600, end: 650, bldg: null, room: null }] })
    const b = section('b', { meetings: [{ type: 'LE', days: 'MWF', start: 650, end: 700, bldg: null, room: null }] })
    expect(findConflicts(['a', 'b'], catalog([a, b]))).toEqual([])
  })

  it('never flags TBA meetings (null days/start/end)', () => {
    const a = section('a', { meetings: [{ type: 'LE', days: null, start: null, end: null, bldg: null, room: null }] })
    const b = section('b', { meetings: [{ type: 'LE', days: null, start: null, end: null, bldg: null, room: null }] })
    expect(findConflicts(['a', 'b'], catalog([a, b]))).toEqual([])
  })

  it('flags exams on the same date with overlapping times', () => {
    const a = section('a', { exams: [{ type: 'FI', date: '2026-12-10', start: 800, end: 1000 }] })
    const b = section('b', { exams: [{ type: 'FI', date: '2026-12-10', start: 900, end: 1100 }] })
    const conflicts = findConflicts(['a', 'b'], catalog([a, b]))
    expect(conflicts).toEqual([{ a: 'a', b: 'b', kind: 'exam', date: '2026-12-10' }])
  })

  it('does not flag exams on different dates even if times overlap', () => {
    const a = section('a', { exams: [{ type: 'FI', date: '2026-12-10', start: 800, end: 1000 }] })
    const b = section('b', { exams: [{ type: 'FI', date: '2026-12-11', start: 800, end: 1000 }] })
    expect(findConflicts(['a', 'b'], catalog([a, b]))).toEqual([])
  })

  it('skips pairs within the same section', () => {
    const a = section('a', {
      meetings: [
        { type: 'LE', days: 'MWF', start: 600, end: 650, bldg: null, room: null },
        { type: 'DI', days: 'MWF', start: 600, end: 650, bldg: null, room: null }
      ]
    })
    expect(findConflicts(['a'], catalog([a]))).toEqual([])
  })
})
