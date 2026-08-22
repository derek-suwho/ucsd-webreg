export function parseTime(time: string): number {
  const [hour, minute] = time.slice(0, -1).split(':').map(Number)
  const am = time.endsWith('a')
  return (hour === 12 ? (am ? 0 : 12) : am ? hour : hour + 12) * 60 + minute
}

export function parseTimeRange(range: string): { start: number; end: number } {
  const [start, end] = range.split('-')
  return { start: parseTime(start), end: parseTime(end) }
}

const DAY_RE = /^(?:(?:Sun|T[uh]|[MWFS])+)$/
export function parseDays(s: string): string | null {
  if (s === 'TBA') return null
  if (!DAY_RE.test(s)) throw new RangeError(`Bad days: "${s}"`)
  return s
}

const UNIT_RE = /\( (\d+)(\.5)?(?: [/-](\d+)(?: by (\d+)(\.5)?)?)? Units\)/
export function parseUnits(courseInfo: string): { from: number; to: number; inc: number } {
  const m = courseInfo.match(UNIT_RE)
  if (!m) throw new SyntaxError(`Missing units in: ${courseInfo}`)
  const from = Number(m[1]) + (m[2] ? 0.5 : 0)
  const to = m[3] ? Number(m[3]) : from
  const inc = m[4] ? Number(m[4]) + (m[5] ? 0.5 : 0) : 1
  return { from, to, inc }
}
