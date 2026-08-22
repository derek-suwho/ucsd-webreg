'use client'

import { useId, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { familySections, type Conflict } from '@webreg/planner'
import { plannerStore } from '@/lib/store'
import { ConflictSummaryHint, GhostSlotView, MeetingBlockView, TrashZone } from './blocks'
import {
  BASE_DAYS,
  DAY_LABELS,
  GRID_HEIGHT_PX,
  HOUR_MARKS,
  buildCalendarData,
  buildGhostSlots,
  calendarKeyboardCoordinateGetter,
  formatHourLabel,
  layoutLanes,
  topPx
} from './layout'

export default function CalendarView({ conflicts }: { conflicts: Conflict[] }) {
  const catalog = useStore(plannerStore, s => s.catalog)
  const schedules = useStore(plannerStore, s => s.schedules)
  const activeScheduleId = useStore(plannerStore, s => s.activeScheduleId)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedAlternatives, setSelectedAlternatives] = useState<Record<string, string>>({})
  const scrollHintId = useId()

  const sectionIds = useMemo(
    () => schedules.find(s => s.id === activeScheduleId)?.sectionIds ?? [],
    [schedules, activeScheduleId]
  )

  const data = useMemo(
    () => (catalog ? buildCalendarData(catalog, sectionIds, conflicts) : null),
    [catalog, sectionIds, conflicts]
  )

  const sectionActions = useMemo(() => {
    if (!catalog) return []
    return [...new Set(sectionIds)].flatMap(sectionId => {
      const section = catalog.sections[sectionId]
      const course = section ? catalog.courses[section.courseId] : null
      if (!section || !course) return []
      const alternatives = familySections(catalog, section.courseId, section.family)
        .filter(candidate => !candidate.cancelled && candidate.id !== section.id)
      return [{ section, course, alternatives }]
    })
  }, [catalog, sectionIds])

  const ghostSlots = useMemo(() => {
    if (!catalog || !activeId) return []
    return buildGhostSlots(catalog, activeId)
  }, [catalog, activeId])

  const displayDays = useMemo(() => {
    if (!data) return BASE_DAYS
    const days = new Set(data.days)
    for (const g of ghostSlots) {
      if (!BASE_DAYS.includes(g.day)) days.add(g.day)
    }
    const ordered = ['Sun', ...BASE_DAYS, 'S']
    return ordered.filter(d => days.has(d))
  }, [data, ghostSlots])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinateGetter() })
  )

  const activeBlock = useMemo(() => data?.blocks.find(b => b.sectionId === activeId), [data, activeId])
  const activeLabel = activeBlock ? `${activeBlock.course.subject} ${activeBlock.course.number} ${activeBlock.section.code}` : ''

  const announcements: Announcements = {
    onDragStart({ active }) {
      return `Picked up ${active.data.current?.label ?? 'section'}. Use arrow keys to move to a sibling slot or the remove zone, then press space to drop.`
    },
    onDragOver({ active, over }) {
      if (!over) return `${active.data.current?.label ?? 'Section'} is not over a drop target.`
      if (over.id === 'trash-zone') return `${active.data.current?.label ?? 'Section'} is over the remove zone.`
      return `${active.data.current?.label ?? 'Section'} is over ${over.data.current?.label ?? 'a target'}.`
    },
    onDragEnd({ active, over }) {
      if (!over) return `${active.data.current?.label ?? 'Section'} was dropped without a target. No change made.`
      if (over.id === 'trash-zone') return `${active.data.current?.label ?? 'Section'} was removed from the schedule.`
      return `${active.data.current?.label ?? 'Section'} was swapped to ${over.data.current?.label ?? 'the target section'}.`
    },
    onDragCancel({ active }) {
      return `Dragging ${active.data.current?.label ?? 'section'} was cancelled.`
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const sectionId = event.active.data.current?.sectionId
    setActiveId(typeof sectionId === 'string' ? sectionId : String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const sectionId = active.data.current?.sectionId
    const fromId = typeof sectionId === 'string' ? sectionId : String(active.id)
    if (over.id === 'trash-zone') {
      plannerStore.getState().removeSection(fromId)
      return
    }
    const overId = String(over.id)
    if (overId.startsWith('ghost|')) {
      const siblingId = overId.split('|')[1]
      plannerStore.getState().swapSection(fromId, siblingId)
    }
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  if (!catalog || !data) {
    return <p className="px-1 py-6 text-sm text-ink-muted">Loading catalog…</p>
  }

  if (data.blocks.length === 0 && data.tba.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-navy-300" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" strokeLinecap="round" />
        </svg>
        <p className="text-[length:var(--font-size-wr-base)] font-semibold text-ink">Nothing planned yet</p>
        <p className="max-w-xs text-sm text-ink-muted">Planned meetings will appear here as a weekly grid.</p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ConflictSummaryHint conflictCount={conflicts.filter(c => c.kind === 'meeting').length} />

      <p id={scrollHintId} className="mb-1 text-[length:var(--font-size-wr-small)] text-ink-muted">
        Scroll horizontally to see all calendar days and vertically to move through times.
      </p>
      <div
        role="region"
        aria-label="Weekly schedule calendar"
        aria-describedby={scrollHintId}
        tabIndex={0}
        className="max-h-[min(70vh,44rem)] overflow-auto pb-2 print:max-h-none print:overflow-visible focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent"
      >
        <div
          className="grid min-w-[640px] border border-[#d8d8d8] bg-wr-ui-content-bg"
          style={{ gridTemplateColumns: `3.25rem repeat(${displayDays.length}, 1fr)` }}
        >
          <div data-calendar-corner className="wr-grid-header sticky left-0 top-0 z-30 bg-wr-ui-content-bg" />
          {displayDays.map(day => (
            <div key={day} data-calendar-day className="wr-grid-header sticky top-0 z-20 text-center uppercase tracking-wide">
              {DAY_LABELS[day]}
            </div>
          ))}

          <div
            data-calendar-time-axis
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

          {displayDays.map(day => (
            <div key={day} className="relative border-l border-[#d8d8d8]" style={{ height: GRID_HEIGHT_PX }}>
              {HOUR_MARKS.map(min => (
                <div key={min} className="absolute left-0 right-0 border-t border-[#d8d8d8]" style={{ top: topPx(min) }} />
              ))}

              {layoutLanes(data.blocks.filter(b => b.day === day)).map(block => (
                <MeetingBlockView key={block.id} block={block} />
              ))}

              {activeId &&
                ghostSlots
                  .filter(g => g.day === day)
                  .map(slot => <GhostSlotView key={slot.key} slot={slot} />)}
            </div>
          ))}
        </div>
      </div>

      {data.tba.length > 0 && (
        <div className="mt-3 text-xs text-ink-muted">
          {data.tba.map(entry => (
            <div key={entry.sectionId}>TBA: {entry.label}</div>
          ))}
        </div>
      )}

      <section aria-label="Calendar section actions" className="mt-3 border-t border-wr-ui-content-border pt-2">
        <h3 className="text-[length:var(--font-size-wr-base)] font-semibold text-ink">Calendar actions</h3>
        <ul className="mt-1 divide-y divide-wr-ui-content-border">
          {sectionActions.map(({ section, course, alternatives }) => {
            const label = `${course.subject} ${course.number} ${section.code}`
            const selected = alternatives.some(candidate => candidate.id === selectedAlternatives[section.id])
              ? selectedAlternatives[section.id]
              : (alternatives[0]?.id ?? '')
            return (
              <li key={section.id} data-section-action className="flex min-h-11 flex-wrap items-center gap-2 py-1">
                <span className="mr-auto font-medium text-ink">{label}</span>
                {alternatives.length > 0 && (
                  <>
                    <label htmlFor={`calendar-alternative-${section.id}`} className="sr-only">
                      Alternative for {label}
                    </label>
                    <select
                      id={`calendar-alternative-${section.id}`}
                      aria-label={`Alternative for ${label}`}
                      value={selected}
                      onChange={event => setSelectedAlternatives(current => ({ ...current, [section.id]: event.target.value }))}
                      className="min-h-11 rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-white px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-wr-header-accent"
                    >
                      {alternatives.map(candidate => (
                        <option key={candidate.id} value={candidate.id}>{candidate.code}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Swap ${label} to selected section`}
                      onClick={() => selected && plannerStore.getState().swapSection(section.id, selected)}
                      className="wr-btn min-h-11 min-w-11"
                    >
                      Swap
                    </button>
                  </>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => plannerStore.getState().removeSection(section.id)}
                  className="wr-btn min-h-11 min-w-11"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <TrashZone active={activeId !== null} />

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }}>
        {activeBlock ? (
          <div className="rounded-[2px] border bg-[#2e648d] border-[#2e648d] px-2 py-1 text-[11px] font-medium text-white shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
            {activeBlock.course.subject} {activeBlock.course.number} {activeBlock.meeting.type}
            <div className="text-[10px] opacity-80">{activeLabel}</div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
