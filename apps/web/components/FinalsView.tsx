'use client'

import { useId, useMemo } from 'react'
import { useStore } from 'zustand'
import type { Conflict } from '@webreg/planner'
import { plannerStore } from '@/lib/store'
import { formatTime } from '@/lib/format'
import {
  GRID_HEIGHT_PX,
  HOUR_MARKS,
  buildFinalsData,
  formatHourLabel,
  heightPx,
  layoutFinalsLanes,
  topPx,
  type Laned,
  type FinalsBlock
} from './calendar/layout'

/** "2026-12-14" -> "Mon, Dec 14" (parsed as local midnight to avoid UTC day-shift). */
function formatExamDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const EXAM_TYPE_LABELS: Record<string, string> = { FI: 'Final', MI: 'Midterm' }

// Uniform FullCalendar v1 event chrome (spec §1.6), recolored to the steel-blue
// band family (--color-wr-band-from, #2e648d) for cross-view cohesion — mirrors
// calendar/blocks.tsx's MeetingBlockView so Calendar and Finals read as one
// time-grid visual language.
function FinalsBlockView({ block }: { block: Laned<FinalsBlock> }) {
  const top = topPx(block.start)
  const height = heightPx(block.start, block.end)
  const laneWidth = 100 / block.lanes
  const left = `calc(${block.lane * laneWidth}% + 2px)`
  const width = `calc(${laneWidth}% - 4px)`
  const label = `${block.course.subject} ${block.course.number} ${block.section.code}`
  const examType = EXAM_TYPE_LABELS[block.examType] ?? block.examType
  const examLabel = `${label}, ${examType}, ${formatExamDate(block.date)}, ${formatTime(block.start, block.end)}`

  return (
    <div
      style={{ top, height, left, width }}
      role="group"
      aria-label={examLabel}
      data-finals-block
      title={`${label} — ${examType}`}
      className={`absolute z-10 overflow-hidden rounded-[2px] border bg-[#2e648d] border-[#2e648d] px-1.5 py-1 text-left text-[11px] leading-tight text-white ${
        block.conflicting ? 'ring-2 ring-wr-conflict ring-offset-1 ring-offset-wr-ui-content-bg' : ''
      }`}
    >
      <div className="font-semibold">
        {block.course.subject} {block.course.number} <span className="font-normal opacity-80">{block.examType}</span>
      </div>
      <div className="tabular-nums opacity-90">{formatTime(block.start, block.end)}</div>
    </div>
  )
}

export default function FinalsView({ conflicts }: { conflicts: Conflict[] }) {
  const catalog = useStore(plannerStore, s => s.catalog)
  const schedules = useStore(plannerStore, s => s.schedules)
  const activeScheduleId = useStore(plannerStore, s => s.activeScheduleId)
  const scrollHintId = useId()

  const sectionIds = useMemo(
    () => schedules.find(s => s.id === activeScheduleId)?.sectionIds ?? [],
    [schedules, activeScheduleId]
  )

  const data = useMemo(() => (catalog ? buildFinalsData(catalog, sectionIds, conflicts) : null), [catalog, sectionIds, conflicts])

  if (!catalog || !data) {
    return <p className="px-1 py-6 text-sm text-ink-muted">Loading catalog…</p>
  }

  if (data.dates.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M12 3l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.2L6.7 19l1.4-6-4.6-4 6.1-.5L12 3z" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <p className="text-[length:var(--font-size-wr-base)] font-semibold text-ink">No finals scheduled</p>
        <p className="max-w-xs text-sm text-ink-muted">Final exam times will appear here once your planned sections have exams on record.</p>
      </div>
    )
  }

  return (
    <div>
      <p id={scrollHintId} className="mb-1 text-[length:var(--font-size-wr-small)] text-ink-muted">
        Scroll horizontally to see every final-exam date and vertically to move through times.
      </p>
      <div
        role="region"
        aria-label="Final exams calendar"
        aria-describedby={scrollHintId}
        tabIndex={0}
        className="max-h-[min(70vh,44rem)] overflow-auto pb-2 print:max-h-none print:overflow-visible focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent"
      >
        <div
          className="grid min-w-[640px] border border-[#d8d8d8] bg-wr-ui-content-bg"
          style={{ gridTemplateColumns: `3.25rem repeat(${data.dates.length}, minmax(9rem, 1fr))` }}
        >
          <div data-finals-corner className="wr-grid-header sticky left-0 top-0 z-30 bg-wr-ui-content-bg" />
          {data.dates.map(date => (
            <div key={date} data-finals-date className="wr-grid-header sticky top-0 z-20 text-center uppercase tracking-wide">
              {formatExamDate(date)}
            </div>
          ))}

          <div
            data-finals-time-axis
            className="sticky left-0 z-20 border-r border-[#d8d8d8] bg-wr-ui-content-bg"
            style={{ height: GRID_HEIGHT_PX }}
          >
            {HOUR_MARKS.map(min => (
              <div
                key={min}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-wr-fc-axis-text"
                style={{ top: topPx(min) }}
              >
                {formatHourLabel(min)}
              </div>
            ))}
          </div>

          {data.dates.map(date => (
            <div key={date} className="relative border-l border-[#d8d8d8]" style={{ height: GRID_HEIGHT_PX }}>
              {HOUR_MARKS.map(min => (
                <div key={min} className="absolute left-0 right-0 border-t border-[#d8d8d8]" style={{ top: topPx(min) }} />
              ))}

              {layoutFinalsLanes(data.blocksByDate[date]).map(block => (
                <FinalsBlockView key={block.id} block={block} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
