import { describe, it, expect } from 'vitest'
import type { CatalogData, CatalogSection, CatalogCourse } from '@webreg/catalog'
import { familySections, swapWithinFamily, planSelection } from './family.js'

function section(id: string, overrides: Partial<CatalogSection> = {}): CatalogSection {
  return {
    id, courseId: 'CSE110', code: 'A00', family: 'LE',
    regNum: null, instructor: null, cap: null, avail: null, wait: null, cancelled: false,
    meetings: [], exams: [],
    ...overrides
  }
}

function catalog(courses: CatalogCourse[], sections: CatalogSection[]): CatalogData {
  return {
    termId: 'FA26', version: 1, generatedAt: '2026-01-01T00:00:00Z',
    courses: Object.fromEntries(courses.map(c => [c.id, c])),
    sections: Object.fromEntries(sections.map(s => [s.id, s]))
  }
}

describe('familySections', () => {
  it('returns sections of the family sorted by code', () => {
    const sections = [
      section('a02', { code: 'A02', family: 'DI' }),
      section('a00', { code: 'A00', family: 'LE' }),
      section('a01', { code: 'A01', family: 'DI' })
    ]
    const course: CatalogCourse = {
      id: 'CSE110', subject: 'CSE', number: '110', title: 'SWE',
      unitsFrom: 4, unitsTo: 4, unitsInc: 1,
      sectionIds: ['a02', 'a00', 'a01']
    }
    const result = familySections(catalog([course], sections), 'CSE110', 'DI')
    expect(result.map(s => s.id)).toEqual(['a01', 'a02'])
  })
})

describe('swapWithinFamily', () => {
  it('replaces fromId with toId preserving order', () => {
    expect(swapWithinFamily(['a01', 'a02', 'a03'], 'a02', 'a05')).toEqual(['a01', 'a05', 'a03'])
  })

  it('returns unchanged copy when fromId is absent', () => {
    const input = ['a01', 'a02']
    const result = swapWithinFamily(input, 'zzz', 'a05')
    expect(result).toEqual(['a01', 'a02'])
    expect(result).not.toBe(input)
  })
})

describe('planSelection', () => {
  const course: CatalogCourse = {
    id: 'CSE110', subject: 'CSE', number: '110', title: 'SWE',
    unitsFrom: 4, unitsTo: 4, unitsInc: 1,
    sectionIds: ['a00']
  }
  const sections = [section('a00', { code: 'A00', family: 'LE' })]

  it('returns [chosen] when chosen belongs to courseId + family', () => {
    const result = planSelection(catalog([course], sections), 'CSE110', 'LE', 'a00')
    expect(result).toEqual(['a00'])
  })

  it('throws when chosen does not belong to courseId + family', () => {
    expect(() => planSelection(catalog([course], sections), 'CSE110', 'DI', 'a00')).toThrow()
  })
})
