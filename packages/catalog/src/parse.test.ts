import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { parseResultPage } from './parse'

const basic = readFileSync(new URL('../fixtures/dept-basic.html', import.meta.url), 'utf8')
const edge = readFileSync(new URL('../fixtures/dept-edge.html', import.meta.url), 'utf8')

describe('parseResultPage basic', () => {
  const { rows } = parseResultPage(basic)
  it('finds 1 course + 4 section rows', () => {
    expect(rows.filter(r => r.kind === 'course')).toHaveLength(1)
    expect(rows.filter(r => r.kind === 'section')).toHaveLength(4)
  })
  it('lecture has no reg number, discussions do', () => {
    const secs = rows.filter(r => r.kind === 'section')
    expect(secs[0].registrationNumber).toBeNull()
    expect(secs[1].registrationNumber).toBe(59266)
  })
  it('final is a dated exam', () => {
    const fi = rows.filter(r => r.kind === 'section').at(-1)!
    expect(fi.meetingType).toBe('FI')
    expect(fi.examDate).toBe('2026-12-07')
  })
})
describe('parseResultPage edge cases', () => {
  const { rows } = parseResultPage(edge)
  it('TBA section has null time+location', () => {
    const tba = rows.find(r => r.kind === 'section' && r.days === null)!
    expect(tba).toBeDefined()
  })
  it('cancelled flagged', () =>
    expect(rows.some(r => r.kind === 'section' && r.cancelled)).toBe(true))
  it('Unlim → null capacity', () =>
    expect(rows.some(r => r.kind === 'section' && r.capacity === null && !r.cancelled)).toBe(true))
  it('FULL Waitlist(3) → waitlisted 3, available 0', () => {
    const full = rows.find(r => r.kind === 'section' && r.waitlisted === 3)!
    expect(full.available).toBe(0)
  })
  it('throws on unknown row', () =>
    expect(() => parseResultPage('<table class="tbrdr"><tbody><tr class="mystery"><td/></tr></tbody></table>')).toThrow())
})
