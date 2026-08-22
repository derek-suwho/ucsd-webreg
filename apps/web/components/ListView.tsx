'use client'

import { useId, useMemo } from 'react'
import { useStore } from 'zustand'
import type { CatalogCourse, CatalogData, CatalogSection } from '@webreg/catalog'
import { findConflicts } from '@webreg/planner'
import { plannerStore } from '@/lib/store'
import { dayRank, formatDays, formatTime, seatChip, SEAT_CHIP_CLASSES, type SeatChip } from '@/lib/format'

type Meeting = CatalogSection['meetings'][number]

const MEETING_TYPE_LABELS: Record<string, string> = {
  LE: 'Lecture',
  DI: 'Discussion',
  LA: 'Lab',
  SE: 'Seminar',
  ST: 'Studio',
  IN: 'Independent Study',
  IT: 'Internship',
  FW: 'Fieldwork',
  TU: 'Tutorial',
  PR: 'Practicum',
  RE: 'Research'
}

// Legacy wr-grid-en/wt/pl full-row background convention (spec §3.4) — reuses the
// same seat-chip variant already driving the Status column, just washed across the row.
const ROW_WASH: Record<SeatChip['variant'], string> = {
  open: 'bg-seat-open-bg/20',
  full: 'bg-seat-full-bg/20',
  unlim: 'bg-seat-unlim-bg/20',
  cancelled: 'bg-seat-cancelled-bg/50'
}

// Reference-image-spec.md §2 item 9 — total column count, used for the empty-state
// row's colSpan (all columns collapsed to one message cell).
const COLUMN_COUNT = 12

function unitsLabel(unitsFrom: number, unitsTo: number): string {
  return unitsFrom === unitsTo ? `${unitsFrom}` : `${unitsFrom}–${unitsTo}`
}

type MeetingRow = {
  key: string
  course: CatalogCourse
  section: CatalogSection
  meeting: Meeting | null
  isFirstOfCourse: boolean
  isFirstOfSection: boolean
}

function sortedMeetings(meetings: Meeting[]): Meeting[] {
  return [...meetings].sort((a, b) => {
    const byDay = dayRank(a.days) - dayRank(b.days)
    if (byDay !== 0) return byDay
    return (a.start ?? Infinity) - (b.start ?? Infinity)
  })
}

function buildRows(catalog: CatalogData, sectionIds: string[]): { rows: MeetingRow[]; staleIds: string[] } {
  const courseOrder: string[] = []
  const plannedByCourse = new Map<string, Set<string>>()
  const staleIds: string[] = []

  for (const id of sectionIds) {
    const section = catalog.sections[id]
    if (!section) {
      staleIds.push(id)
      continue
    }
    if (!plannedByCourse.has(section.courseId)) {
      plannedByCourse.set(section.courseId, new Set())
      courseOrder.push(section.courseId)
    }
    plannedByCourse.get(section.courseId)!.add(id)
  }

  const rows: MeetingRow[] = []

  for (const courseId of courseOrder) {
    const course = catalog.courses[courseId]
    if (!course) continue
    const plannedSet = plannedByCourse.get(courseId)!
    // catalog's own section order (LE, then DI/LA…) rather than plan-click order
    const sectionIdsForCourse = course.sectionIds.filter(id => plannedSet.has(id))
    let isFirstOfCourse = true

    for (const sectionId of sectionIdsForCourse) {
      const section = catalog.sections[sectionId]
      if (!section) continue
      const meetingSlots: (Meeting | null)[] = section.meetings.length > 0 ? sortedMeetings(section.meetings) : [null]

      meetingSlots.forEach((meeting, i) => {
        rows.push({
          key: `${sectionId}-${i}`,
          course,
          section,
          meeting,
          isFirstOfCourse: isFirstOfCourse && i === 0,
          isFirstOfSection: i === 0
        })
      })
      isFirstOfCourse = false
    }
  }

  return { rows, staleIds }
}

// Reference-image-spec.md §2 item 9 — ListView's own header/row chrome. Local to this
// file (not the shared GRID_TH_CLASS/GRID_TD_CLASS in lib/format.ts, which stays as-is
// for CourseAccordion): centered bold 12.5px #000 header on the th-gradient tokens with
// #c8c8c8 separators, ~40px tall; 12.5px #222 rows separated by #d8d8d8 hairlines.
const TH_CLASS =
  'sticky top-0 z-20 h-10 whitespace-nowrap border border-wr-th-border bg-gradient-to-b from-wr-th-from to-wr-th-to px-2 text-center align-middle text-[12.5px] font-bold text-black'
const TD_CLASS = 'border-b border-r border-[#d8d8d8] px-2 py-1.5 align-top last:border-r-0 text-[12.5px]'

export default function ListView() {
  const catalog = useStore(plannerStore, s => s.catalog)
  const schedules = useStore(plannerStore, s => s.schedules)
  const activeScheduleId = useStore(plannerStore, s => s.activeScheduleId)
  const scrollHintId = useId()

  const sectionIds = useMemo(
    () => schedules.find(s => s.id === activeScheduleId)?.sectionIds ?? [],
    [schedules, activeScheduleId]
  )

  const { rows, staleIds } = useMemo(() => {
    if (!catalog) return { rows: [] as MeetingRow[], staleIds: [] as string[] }
    return buildRows(catalog, sectionIds)
  }, [catalog, sectionIds])

  // wr-schedule-conflict row highlight (spec §3.4/§3.6) — derived locally from data this
  // component already reads (catalog + the active schedule's section ids), same conflict
  // detector ConflictBanner/CalendarView use, so no new prop or store wiring is needed.
  const conflictSectionIds = useMemo(() => {
    if (!catalog) return new Set<string>()
    const conflicts = findConflicts(sectionIds.filter(id => catalog.sections[id]), catalog)
    return new Set(conflicts.flatMap(c => [c.a, c.b]))
  }, [catalog, sectionIds])

  const handleRemove = (sectionId: string) => plannerStore.getState().removeSection(sectionId)

  if (!catalog) {
    return <p className="px-1 py-6 text-[length:var(--font-size-wr-base)] text-ink-muted">Loading catalog…</p>
  }

  const isEmpty = rows.length === 0 && staleIds.length === 0

  return (
    <>
      <p id={scrollHintId} className="px-1 py-1 text-[length:var(--font-size-wr-small)] text-ink-muted">
        Scroll horizontally and vertically to see every planned-class row and column.
      </p>
      <div
        role="region"
        aria-label="Planned classes table"
        aria-describedby={scrollHintId}
        tabIndex={0}
        className="max-h-[min(70vh,44rem)] overflow-auto print:max-h-none print:overflow-visible focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent"
      >
      <table
        id="list-id-table"
        aria-label="Planned classes"
        className="w-full min-w-[900px] border-collapse text-[12.5px] leading-[var(--leading-wr-base)]"
      >
        <thead>
          <tr>
            <th scope="col" data-sticky-identity="course" className={`${TH_CLASS} left-0 z-30 w-32 min-w-32`}>
              Subject Course
            </th>
            <th scope="col" data-sticky-identity="title" className={`${TH_CLASS} left-32 z-30 w-48 min-w-48`}>
              Title
            </th>
            <th scope="col" data-sticky-identity="section" className={`${TH_CLASS} left-80 z-30 w-24 min-w-24`}>
              Section Code
            </th>
            <th scope="col" className={TH_CLASS}>
              Type
            </th>
            <th scope="col" className={TH_CLASS}>
              Instructor
            </th>
            <th scope="col" className={TH_CLASS}>
              Units
            </th>
            <th scope="col" className={TH_CLASS}>
              Days
            </th>
            <th scope="col" className={TH_CLASS}>
              Time
            </th>
            <th scope="col" className={TH_CLASS}>
              BLDG
            </th>
            <th scope="col" className={TH_CLASS}>
              Room
            </th>
            <th scope="col" className={TH_CLASS}>
              Status
              <br />/ (Position)
            </th>
            <th scope="col" data-print-action className={TH_CLASS}>
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={COLUMN_COUNT} className="h-[42px] px-4 text-left align-middle text-[13px] text-[#222]">
                No classes on your schedule for this term. Search for classes above, then Plan them.
              </td>
            </tr>
          ) : (
            <>
              {rows.map(row => (
                <ListRow key={row.key} row={row} conflicting={conflictSectionIds.has(row.section.id)} onRemove={handleRemove} />
              ))}
              {staleIds.map(id => (
                <StaleListRow key={id} sectionId={id} onRemove={handleRemove} />
              ))}
            </>
          )}
        </tbody>
      </table>
      </div>
    </>
  )
}

function ListRow({
  row,
  conflicting,
  onRemove
}: {
  row: MeetingRow
  conflicting: boolean
  onRemove: (sectionId: string) => void
}) {
  const { course, section, meeting, isFirstOfCourse, isFirstOfSection } = row
  const chip = seatChip(section)
  const typeCode = meeting?.type ?? 'TBA'
  const rowWash = conflicting ? 'bg-danger-bg/40' : ROW_WASH[chip.variant]
  const accentClass = conflicting ? 'border-l-danger' : 'border-l-transparent'

  return (
    <tr className={`group ${rowWash} hover:bg-wr-row-hover`}>
      <td
        data-sticky-identity="course"
        className={`${TD_CLASS} sticky left-0 z-10 w-32 min-w-32 border-l-[3px] bg-wr-ui-content-bg group-hover:bg-wr-row-hover ${accentClass} whitespace-nowrap ${isFirstOfCourse ? 'font-semibold text-[#222]' : 'text-[#666666]'}`}
      >
        {course.subject} {course.number}
      </td>
      <td
        data-sticky-identity="title"
        className={`${TD_CLASS} sticky left-32 z-10 w-48 min-w-48 bg-wr-ui-content-bg group-hover:bg-wr-row-hover ${isFirstOfCourse ? 'text-[#222]' : 'text-[#666666]'}`}
      >
        {course.title}
      </td>
      <td
        data-sticky-identity="section"
        className={`${TD_CLASS} sticky left-80 z-10 w-24 min-w-24 bg-wr-ui-content-bg font-medium text-[#222] group-hover:bg-wr-row-hover`}
      >
        {isFirstOfSection && (
          <span className="flex flex-wrap items-center gap-1">
            {section.code}
            {section.cancelled && (
              <span className="rounded bg-seat-cancelled-bg px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-seat-cancelled">
                Cancelled
              </span>
            )}
          </span>
        )}
      </td>
      <td className={`${TD_CLASS} text-[#666666]`} title={MEETING_TYPE_LABELS[typeCode] ?? undefined}>
        {typeCode}
      </td>
      <td className={`${TD_CLASS} text-[#666666]`}>{isFirstOfSection ? (section.instructor ?? 'Staff') : ''}</td>
      <td className={`${TD_CLASS} text-right tabular-nums text-[#666666]`}>
        {isFirstOfCourse ? unitsLabel(course.unitsFrom, course.unitsTo) : ''}
      </td>
      <td className={`${TD_CLASS} tabular-nums text-[#666666]`}>{formatDays(meeting?.days ?? null)}</td>
      <td className={`${TD_CLASS} whitespace-nowrap tabular-nums text-[#666666]`}>{formatTime(meeting?.start ?? null, meeting?.end ?? null)}</td>
      <td className={`${TD_CLASS} text-[#666666]`}>{meeting?.bldg ?? '—'}</td>
      <td className={`${TD_CLASS} text-[#666666]`}>{meeting?.room ?? '—'}</td>
      <td className={`${TD_CLASS} text-right`}>
        {isFirstOfSection && (
          <span className="inline-flex flex-wrap items-center justify-end gap-1">
            <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-medium tabular-nums ${SEAT_CHIP_CLASSES[chip.variant]}`}>
              {chip.label}
            </span>
            {conflicting && (
              <span
                className="inline-block rounded bg-danger-bg px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
                title="This meeting time conflicts with another planned section"
              >
                Conflict
              </span>
            )}
          </span>
        )}
      </td>
      <td data-print-action className={`${TD_CLASS} text-right`}>
        {isFirstOfSection && (
          <button
            type="button"
            onClick={() => onRemove(section.id)}
            aria-label={`Remove ${course.subject} ${course.number} ${section.code}`}
            className="wr-btn min-h-11 min-w-11"
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  )
}

function StaleListRow({ sectionId, onRemove }: { sectionId: string; onRemove: (sectionId: string) => void }) {
  return (
    <tr className="bg-wr-ui-error-bg/60 hover:bg-wr-row-hover">
      <td colSpan={COLUMN_COUNT - 1} className={`${TD_CLASS} border-l-[3px] border-l-wr-ui-error-border`}>
        <span className="font-medium text-wr-ui-error-text">No longer offered</span>
        <span className="ml-2 text-[#666666]">This planned section isn&rsquo;t in the current catalog.</span>
      </td>
      <td data-print-action className={`${TD_CLASS} text-right`}>
        <button
          type="button"
          onClick={() => onRemove(sectionId)}
          aria-label="Remove section that is no longer offered"
          className="wr-btn min-h-11 min-w-11"
        >
          Remove
        </button>
      </td>
    </tr>
  )
}
