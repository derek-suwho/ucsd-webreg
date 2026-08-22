'use client'

import { useDraggable, useDroppable } from '@dnd-kit/core'
import { formatTime } from '@/lib/format'
import { heightPx, topPx } from './layout'
import type { GhostSlot, LanedBlock } from './layout'

export function ConflictSummaryHint({ conflictCount }: { conflictCount: number }) {
  if (conflictCount === 0) return null
  return (
    <p className="mb-2 text-[11px] text-wr-conflict">
      {conflictCount} meeting {conflictCount === 1 ? 'conflict' : 'conflicts'} outlined below — see summary above.
    </p>
  )
}

export function MeetingBlockView({ block }: { block: LanedBlock }) {
  // Unique per rendered block (not per section) — a section with a multi-day meeting renders one
  // block per day, and dnd-kit requires each to register its own draggable node/id.
  const draggableId = `drag|${block.id}`
  const label = `${block.course.subject} ${block.course.number} ${block.section.code}`
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    disabled: !block.draggable,
    data: { label, sectionId: block.sectionId }
  })

  const top = topPx(block.meeting.start as number)
  const height = heightPx(block.meeting.start as number, block.meeting.end as number)
  const place = block.meeting.bldg ? `${block.meeting.bldg}${block.meeting.room ? ` ${block.meeting.room}` : ''}` : 'TBA'
  const laneWidth = 100 / block.lanes
  const left = `calc(${block.lane * laneWidth}% + 2px)`
  const width = `calc(${laneWidth}% - 4px)`

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        top,
        height,
        left,
        width,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        opacity: isDragging ? 0.35 : 1
      }}
      title={block.draggable ? `Drag to swap ${label} to a sibling section` : label}
      className={`absolute z-10 overflow-hidden rounded-[2px] border bg-wr-fc-event-bg border-wr-fc-event-border px-1.5 py-1 text-left text-[11px] leading-tight text-wr-fc-event-text transition-shadow ${
        block.conflicting ? 'ring-2 ring-wr-conflict ring-offset-1 ring-offset-wr-ui-content-bg' : ''
      } ${
        block.draggable
          ? 'cursor-grab touch-none active:cursor-grabbing hover:shadow-[0_2px_8px_rgba(0,0,0,0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent'
          : ''
      }`}
    >
      {block.draggable && (
        <span aria-hidden="true" className="absolute right-1 top-1 flex gap-0.5 opacity-70">
          <span className="h-1 w-1 rounded-full bg-wr-fc-event-text" />
          <span className="h-1 w-1 rounded-full bg-wr-fc-event-text" />
        </span>
      )}
      <div className="font-semibold">
        {block.course.subject} {block.course.number} {block.section.code}
      </div>
      <div className="tabular-nums opacity-90">{formatTime(block.meeting.start, block.meeting.end)}</div>
      <div className="truncate opacity-80">{place}</div>
    </div>
  )
}

export function GhostSlotView({ slot }: { slot: GhostSlot }) {
  const label = `sibling section ${slot.siblingCode}`
  const { setNodeRef, isOver } = useDroppable({ id: slot.key, data: { label, siblingId: slot.siblingId } })
  const top = topPx(slot.start)
  const height = heightPx(slot.start, slot.end)

  return (
    <div
      ref={setNodeRef}
      style={{ top, height }}
      className={`absolute inset-x-0.5 z-20 rounded-md border-2 border-dashed px-1.5 py-1 text-[11px] font-medium text-navy-600 transition-colors ${
        isOver ? 'border-gold-600 bg-gold-100' : 'border-navy-400 bg-navy-50/70'
      }`}
    >
      Swap to {slot.siblingCode}
    </div>
  )
}

export function TrashZone({ active }: { active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'trash-zone', data: { label: 'remove from schedule' } })
  if (!active) return null

  return (
    <div
      ref={setNodeRef}
      className={`fixed inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 border-t py-3 text-sm font-medium transition-colors ${
        isOver ? 'border-danger bg-danger-bg text-danger' : 'border-navy-900/15 bg-navy-900/90 text-navy-100'
      }`}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m-6.5 0l.6 10a1.5 1.5 0 001.5 1.4h3.8a1.5 1.5 0 001.5-1.4l.6-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Drop here to remove from schedule
    </div>
  )
}
