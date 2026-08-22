'use client'

import { Fragment, useId, useMemo, useState } from 'react'
import type { CatalogData, CatalogSection } from '@webreg/catalog'
import { familySections } from '@webreg/planner'
import { formatDays, formatTime, seatChip, SEAT_CHIP_CLASSES, GRID_TH_CLASS, GRID_TD_CLASS, type SeatChip } from '@/lib/format'
import ConfirmPlanDialog from './ConfirmPlanDialog'

type Meeting = CatalogSection['meetings'][number]

type CourseAccordionProps = {
  catalog: CatalogData
  courseId: string
  activeSectionIds: string[]
  onPlan: (courseId: string, family: string, sectionId: string) => void
  onRemove: (sectionId: string) => void
}

function unitsLabel(unitsFrom: number, unitsTo: number): string {
  return unitsFrom === unitsTo ? `${unitsFrom} units` : `${unitsFrom}-${unitsTo} units`
}

// Legacy grid used per-status seat text coloring (spec §1.5); reuses the same
// seat-* tokens as the SEAT_CHIP_CLASSES badge, just as plain text color.
const SEAT_TEXT_CLASS: Record<SeatChip['variant'], string> = {
  open: 'text-seat-open',
  full: 'text-seat-full',
  unlim: 'text-seat-unlim',
  cancelled: 'text-seat-cancelled'
}

// Exact column order from legacy-ui-spec.md §3.3 (Book column omitted — no
// bookstore-link field exists anywhere in CatalogSection to source it from).
// TH/TD chrome shared with ListView via lib/format.ts so the two grids can't drift apart.
const TH_CLASS = GRID_TH_CLASS
const TD_CLASS = GRID_TD_CLASS

export default function CourseAccordion({ catalog, courseId, activeSectionIds, onPlan, onRemove }: CourseAccordionProps) {
  const course = catalog.courses[courseId]
  const panelId = useId()
  const [expanded, setExpanded] = useState(false)
  const [dialogFamily, setDialogFamily] = useState<string | null>(null)
  const activeSet = useMemo(() => new Set(activeSectionIds), [activeSectionIds])

  const families = useMemo(() => {
    if (!course) return []
    const seen: string[] = []
    for (const id of course.sectionIds) {
      const family = catalog.sections[id]?.family
      if (family && !seen.includes(family)) seen.push(family)
    }
    return seen.map(family => ({ family, sections: familySections(catalog, courseId, family) }))
  }, [catalog, course, courseId])

  if (!course) return null

  const dialogGroup = families.find(f => f.family === dialogFamily)
  const allCancelled = families.length > 0 && families.every(f => f.sections.every(section => section.cancelled))
  let zebra = 0

  return (
    <div className="border-b border-wr-grid-border bg-wr-row">
      <button
        type="button"
        onClick={() => setExpanded(current => !current)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="wr-grid-header flex w-full cursor-pointer items-center justify-between gap-3 text-left hover:brightness-[0.97] active:brightness-95 focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-[-2px] focus-visible:outline-wr-header-band"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <svg
            viewBox="0 0 20 20"
            className={`h-2.5 w-2.5 shrink-0 text-wr-ui-header-text transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6 3l8 7-8 7z" />
          </svg>
          <span className="text-[length:var(--font-size-wr-heading)] font-bold text-wr-ui-header-text">
            {course.subject} {course.number}
          </span>
          <span className="truncate font-normal text-wr-ui-header-text">
            {course.title} ({unitsLabel(course.unitsFrom, course.unitsTo)})
          </span>
          {allCancelled && (
            <span className="shrink-0 text-[length:var(--font-size-wr-small)] font-normal text-wr-ui-error-text">
              All sections cancelled
            </span>
          )}
        </span>
      </button>

      <div id={panelId} hidden={!expanded} className="overflow-x-auto pb-2">
        <table className="w-full min-w-[860px] border-collapse border border-wr-grid-border text-[12.5px] text-[#222222] leading-wr-base">
          <thead>
            <tr>
              <th scope="col" className={TH_CLASS}>Section ID</th>
              <th scope="col" className={TH_CLASS}>Section</th>
              <th scope="col" className={TH_CLASS}>Meeting Type</th>
              <th scope="col" className={TH_CLASS}>Days</th>
              <th scope="col" className={TH_CLASS}>Time</th>
              <th scope="col" className={TH_CLASS}>Building</th>
              <th scope="col" className={TH_CLASS}>Room</th>
              <th scope="col" className={`${TH_CLASS} text-right`}>Avail Seats</th>
              <th scope="col" className={`${TH_CLASS} text-right`}>Total Seats</th>
              <th scope="col" className={`${TH_CLASS} text-right`}>Waitlist Count</th>
              <th scope="col" className={TH_CLASS}>Instructor</th>
              <th scope="col" className={TH_CLASS}>Action</th>
            </tr>
          </thead>
          <tbody>
            {families.map(({ family, sections }) => {
              const enrollable = sections.filter(s => !s.cancelled)
              const hasFullSection = enrollable.some(section => seatChip(section).variant === 'full')
              const plannedId = sections.find(s => activeSet.has(s.id))?.id ?? null

              return (
                <Fragment key={family}>
                  <tr className="bg-navy-50">
                    <td colSpan={11} className={TD_CLASS}>
                      <span className="font-bold text-wr-link">Section {family}</span>
                      {hasFullSection && (
                        <span className="ml-2 text-[length:var(--font-size-wr-small)] font-normal text-[#7a4b00]">
                          Full sections can still be planned. Planning does not reserve a seat.
                        </span>
                      )}
                    </td>
                    <td className={`${TD_CLASS} text-right`}>
                      {plannedId ? (
                        <button type="button" onClick={() => onRemove(plannedId)} className="wr-btn wr-btn-success">
                          Planned ✓
                        </button>
                      ) : enrollable.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => (enrollable.length === 1 ? onPlan(courseId, family, enrollable[0].id) : setDialogFamily(family))}
                          className="wr-btn"
                        >
                          Plan
                        </button>
                      ) : (
                        <span className="text-[length:var(--font-size-wr-small)] text-seat-cancelled">Cancelled</span>
                      )}
                    </td>
                  </tr>

                  {sections.flatMap(section => {
                    const chip = seatChip(section)
                    const meetings: (Meeting | null)[] = section.meetings.length > 0 ? section.meetings : [null]
                    const selected = section.id === plannedId
                    const stripe = zebra++ % 2 === 0 ? 'bg-wr-row' : 'bg-[#f7f9fa]'
                    const rowBg = section.cancelled ? 'bg-seat-cancelled-bg/50' : selected ? 'bg-wr-ui-highlight-bg' : stripe

                    return meetings.map((meeting, i) => {
                      const first = i === 0
                      return (
                        <tr key={`${section.id}-${i}`} className={`${rowBg} hover:bg-[#eef3f7]`}>
                          <td className={TD_CLASS}>{first ? (section.regNum ?? '—') : ''}</td>
                          <td className={`${TD_CLASS} font-medium`}>{first ? section.code : ''}</td>
                          <td className={TD_CLASS}>{meeting?.type ?? '—'}</td>
                          <td className={TD_CLASS}>{formatDays(meeting?.days ?? null)}</td>
                          <td className={`${TD_CLASS} whitespace-nowrap`}>{formatTime(meeting?.start ?? null, meeting?.end ?? null)}</td>
                          <td className={TD_CLASS}>{meeting?.bldg ?? '—'}</td>
                          <td className={TD_CLASS}>{meeting?.room ?? '—'}</td>
                          <td className={`${TD_CLASS} text-right tabular-nums ${SEAT_TEXT_CLASS[chip.variant]}`}>
                            {first ? (section.cap === null ? '—' : Math.max(section.avail ?? 0, 0)) : ''}
                          </td>
                          <td className={`${TD_CLASS} text-right tabular-nums ${SEAT_TEXT_CLASS[chip.variant]}`}>
                            {first ? (section.cap ?? 'No Limit') : ''}
                          </td>
                          <td className={`${TD_CLASS} text-right tabular-nums ${SEAT_TEXT_CLASS[chip.variant]}`}>
                            {first ? (section.wait ?? 0) : ''}
                          </td>
                          <td className={TD_CLASS}>{first ? (section.instructor ?? 'Staff') : ''}</td>
                          <td className={`${TD_CLASS} text-right`}>
                            {first && (
                              <span className={`inline-block rounded px-1 py-0.5 text-[10px] font-medium ${SEAT_CHIP_CLASSES[chip.variant]}`}>
                                {chip.label}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {dialogGroup && (
        <ConfirmPlanDialog
          course={course}
          family={dialogGroup.family}
          sections={dialogGroup.sections.filter(s => !s.cancelled)}
          onConfirm={sectionId => {
            onPlan(courseId, dialogGroup.family, sectionId)
            setDialogFamily(null)
          }}
          onCancel={() => setDialogFamily(null)}
        />
      )}
    </div>
  )
}
