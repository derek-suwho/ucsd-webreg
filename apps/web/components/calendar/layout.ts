import type { ClientRect, KeyboardCoordinateGetter } from '@dnd-kit/core'
import type { CatalogCourse, CatalogData, CatalogSection } from '@webreg/catalog'
import type { Conflict } from '@webreg/planner'
import { familySections } from '@webreg/planner'

export type Meeting = CatalogSection['meetings'][number]

export const DAY_TOKEN_RE = /Sun|T[uh]|[MWFS]/g
export const BASE_DAYS = ['M', 'Tu', 'W', 'Th', 'F']
export const DAY_LABELS: Record<string, string> = { Sun: 'Sun', M: 'Mon', Tu: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', S: 'Sat' }

export const GRID_START_MIN = 7 * 60
export const GRID_END_MIN = 22 * 60
export const ROW_MIN = 30
export const ROW_PX = 26 // pixels per 30-minute row

export const PALETTE = [
  { text: 'text-block-1', bg: 'bg-block-1-bg', border: 'border-block-1', dot: 'bg-block-1' },
  { text: 'text-block-2', bg: 'bg-block-2-bg', border: 'border-block-2', dot: 'bg-block-2' },
  { text: 'text-block-3', bg: 'bg-block-3-bg', border: 'border-block-3', dot: 'bg-block-3' },
  { text: 'text-block-4', bg: 'bg-block-4-bg', border: 'border-block-4', dot: 'bg-block-4' },
  { text: 'text-block-5', bg: 'bg-block-5-bg', border: 'border-block-5', dot: 'bg-block-5' }
]

export function tokenizeDays(days: string): string[] {
  return days.match(DAY_TOKEN_RE) ?? []
}

export function clampMinutes(min: number): number {
  return Math.min(Math.max(min, GRID_START_MIN), GRID_END_MIN)
}

export function topPx(startMin: number): number {
  return ((clampMinutes(startMin) - GRID_START_MIN) / ROW_MIN) * ROW_PX
}

export function heightPx(startMin: number, endMin: number): number {
  return Math.max(((clampMinutes(endMin) - clampMinutes(startMin)) / ROW_MIN) * ROW_PX, ROW_PX / 2)
}

export type PlacedBlock = {
  id: string
  sectionId: string
  section: CatalogSection
  course: CatalogCourse
  meeting: Meeting
  day: string
  colorIndex: number
  conflicting: boolean
  draggable: boolean
}

export type TbaEntry = { sectionId: string; label: string }

export type CalendarData = {
  days: string[]
  blocks: PlacedBlock[]
  tba: TbaEntry[]
}

function meetingTypeShort(section: CatalogSection, meeting: Meeting | undefined): string {
  return meeting?.type ?? section.family
}

/** Builds the grid's blocks/tba list from planned sections, using conflicts computed once upstream (page-level). */
export function buildCalendarData(catalog: CatalogData, sectionIds: string[], conflicts: Conflict[]): CalendarData {
  const validSectionIds = sectionIds.filter(id => catalog.sections[id])

  const conflictDaySet = new Set<string>()
  for (const c of conflicts) {
    if (c.kind !== 'meeting' || !c.day) continue
    conflictDaySet.add(`${c.a}__${c.day}`)
    conflictDaySet.add(`${c.b}__${c.day}`)
  }

  const courseColorOrder: string[] = []
  const blocks: PlacedBlock[] = []
  const tba: TbaEntry[] = []
  const extraDays = new Set<string>()

  for (const sectionId of validSectionIds) {
    const section = catalog.sections[sectionId]
    const course = catalog.courses[section.courseId]
    if (!course) continue

    if (!courseColorOrder.includes(course.id)) courseColorOrder.push(course.id)
    const colorIndex = courseColorOrder.indexOf(course.id) % PALETTE.length

    const siblings = familySections(catalog, section.courseId, section.family).filter(s => !s.cancelled)
    const draggable = siblings.length > 1

    const timedMeetings = section.meetings.filter(m => m.days !== null && m.start !== null && m.end !== null)

    if (timedMeetings.length === 0) {
      tba.push({ sectionId, label: `${course.subject} ${course.number} ${section.code} ${meetingTypeShort(section, section.meetings[0])}` })
      continue
    }

    for (const meeting of timedMeetings) {
      const days = tokenizeDays(meeting.days as string)
      for (const day of days) {
        if (!BASE_DAYS.includes(day)) extraDays.add(day)
        blocks.push({
          id: `${sectionId}-${meeting.type}-${meeting.start}-${day}`,
          sectionId,
          section,
          course,
          meeting,
          day,
          colorIndex,
          conflicting: conflictDaySet.has(`${sectionId}__${day}`),
          draggable
        })
      }
    }
  }

  const days = [...BASE_DAYS]
  if (extraDays.has('S')) days.push('S')
  if (extraDays.has('Sun')) days.unshift('Sun')

  return { days, blocks, tba }
}

export type LanedBlock = PlacedBlock & { lane: number; lanes: number }
export type Laned<T> = T & { lane: number; lanes: number }

/**
 * Greedy interval-graph coloring: overlapping items share side-by-side lanes instead of stacking.
 * Generic over any item shape via getStart/getEnd so both the weekly calendar and the finals grid
 * (whose blocks carry time differently) can share one algorithm instead of two copies.
 */
export function assignLanes<T>(items: T[], getStart: (item: T) => number, getEnd: (item: T) => number): Laned<T>[] {
  const sorted = [...items].sort((a, b) => getStart(a) - getStart(b))
  const laneEnds: number[] = [] // end time currently occupying each lane
  const laned: (T & { lane: number })[] = []

  for (const item of sorted) {
    const start = getStart(item)
    const end = getEnd(item)
    let lane = laneEnds.findIndex(laneEnd => laneEnd <= start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = end
    laned.push({ ...item, lane })
  }

  // cluster overlapping items (connected via shared time) to size lanes per cluster, not globally
  const result: Laned<T>[] = []
  let clusterStart = 0
  while (clusterStart < laned.length) {
    let clusterEnd = getEnd(laned[clusterStart])
    let i = clusterStart + 1
    while (i < laned.length && getStart(laned[i]) < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, getEnd(laned[i]))
      i++
    }
    const cluster = laned.slice(clusterStart, i)
    const lanes = Math.max(...cluster.map(b => b.lane)) + 1
    for (const b of cluster) result.push({ ...b, lanes })
    clusterStart = i
  }

  return result
}

export function layoutLanes(blocks: PlacedBlock[]): LanedBlock[] {
  return assignLanes(
    blocks,
    b => b.meeting.start ?? 0,
    b => b.meeting.end ?? 0
  )
}

export type FinalsBlock = {
  id: string
  sectionId: string
  section: CatalogSection
  course: CatalogCourse
  examType: string
  date: string
  start: number
  end: number
  conflicting: boolean
}

export type FinalsData = {
  dates: string[]
  blocksByDate: Record<string, FinalsBlock[]>
}

/** Builds exam-date columns/blocks from planned sections, using conflicts computed once upstream (page-level). */
export function buildFinalsData(catalog: CatalogData, sectionIds: string[], conflicts: Conflict[]): FinalsData {
  const validSectionIds = sectionIds.filter(id => catalog.sections[id])

  const conflictSet = new Set<string>()
  for (const c of conflicts) {
    if (c.kind !== 'exam') continue
    conflictSet.add(`${c.a}|${c.date}`)
    conflictSet.add(`${c.b}|${c.date}`)
  }

  const blocks: FinalsBlock[] = []

  for (const sectionId of validSectionIds) {
    const section = catalog.sections[sectionId]
    const course = catalog.courses[section.courseId]
    if (!course) continue

    for (const exam of section.exams) {
      blocks.push({
        id: `${sectionId}-${exam.type}-${exam.date}-${exam.start}`,
        sectionId,
        section,
        course,
        examType: exam.type,
        date: exam.date,
        start: exam.start,
        end: exam.end,
        conflicting: conflictSet.has(`${sectionId}|${exam.date}`)
      })
    }
  }

  const dates = [...new Set(blocks.map(b => b.date))].sort()
  const blocksByDate: Record<string, FinalsBlock[]> = {}
  for (const date of dates) {
    blocksByDate[date] = blocks.filter(b => b.date === date).sort((a, b) => a.start - b.start)
  }

  return { dates, blocksByDate }
}

export function layoutFinalsLanes(blocks: FinalsBlock[]): Laned<FinalsBlock>[] {
  return assignLanes(
    blocks,
    b => b.start,
    b => b.end
  )
}

export type GhostSlot = { key: string; siblingId: string; siblingCode: string; day: string; start: number; end: number }

export function buildGhostSlots(catalog: CatalogData, activeSectionId: string): GhostSlot[] {
  const active = catalog.sections[activeSectionId]
  if (!active) return []
  const siblings = familySections(catalog, active.courseId, active.family).filter(s => !s.cancelled && s.id !== activeSectionId)

  const slots: GhostSlot[] = []
  for (const sib of siblings) {
    const timed = sib.meetings.filter(m => m.days !== null && m.start !== null && m.end !== null)
    for (const meeting of timed) {
      for (const day of tokenizeDays(meeting.days as string)) {
        slots.push({
          key: `ghost|${sib.id}|${meeting.type}|${meeting.start}|${day}`,
          siblingId: sib.id,
          siblingCode: sib.code,
          day,
          start: meeting.start as number,
          end: meeting.end as number
        })
      }
    }
  }
  return slots
}

export const HOUR_MARKS: number[] = []
for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) HOUR_MARKS.push(m)

export function formatHourLabel(min: number): string {
  const hour = Math.floor(min / 60)
  const period = hour < 12 ? 'AM' : 'PM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12} ${period}`
}

export const GRID_HEIGHT_PX = ((GRID_END_MIN - GRID_START_MIN) / ROW_MIN) * ROW_PX

export function calendarKeyboardCoordinateGetter(): KeyboardCoordinateGetter {
  return (event, { context, currentCoordinates }) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return undefined

    const entries: [string, ClientRect][] = []
    context.droppableRects.forEach((rect, id) => {
      if (typeof id === 'string' && (id.startsWith('ghost|') || id === 'trash-zone')) entries.push([id, rect])
    })
    if (entries.length === 0) return undefined
    entries.sort((a, b) => a[1].top - b[1].top || a[1].left - b[1].left)

    event.preventDefault()
    const currentIndex = entries.findIndex(
      ([, rect]) =>
        Math.abs(rect.top + rect.height / 2 - currentCoordinates.y) < 1 && Math.abs(rect.left + rect.width / 2 - currentCoordinates.x) < 1
    )
    let nextIndex: number
    if (currentIndex === -1) nextIndex = 0
    else if (event.code === 'ArrowDown' || event.code === 'ArrowRight') nextIndex = (currentIndex + 1) % entries.length
    else nextIndex = (currentIndex - 1 + entries.length) % entries.length

    const [, rect] = entries[nextIndex]
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }
}
