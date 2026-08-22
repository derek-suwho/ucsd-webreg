import { describe, it, expect } from 'vitest'
import { parseTime, parseTimeRange, parseDays, parseUnits } from './time'

describe('parseTime', () => {
  it.each([['9:00a', 540], ['12:30p', 750], ['12:05a', 5], ['11:50p', 1430]])('%s → %i',
    (s, n) => expect(parseTime(s)).toBe(n))
})
describe('parseTimeRange', () => {
  it('parses evening range', () =>
    expect(parseTimeRange('7:00p-9:59p')).toEqual({ start: 1140, end: 1319 }))
})
describe('parseDays', () => {
  it('canonicalizes', () => expect(parseDays('TuTh')).toBe('TuTh'))
  it('TBA → null', () => expect(parseDays('TBA')).toBeNull())
  it('rejects garbage', () => expect(() => parseDays('XYZ')).toThrow())
})
describe('parseUnits', () => {
  it('fixed', () => expect(parseUnits('Intro ( 4 Units)')).toEqual({ from: 4, to: 4, inc: 1 }))
  it('range', () => expect(parseUnits('Sem ( 1 -4 Units)')).toEqual({ from: 1, to: 4, inc: 1 }))
  it('half-step', () => expect(parseUnits('X ( 1 /5 by 0.5 Units)')).toEqual({ from: 1, to: 5, inc: 0.5 }))
  it('half-unit fixed', () => expect(parseUnits('Y ( 2.5 Units)')).toEqual({ from: 2.5, to: 2.5, inc: 1 }))
})
