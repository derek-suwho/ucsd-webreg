import type { CatalogSection } from '@webreg/catalog'

/** One line per meeting: "MWF 10:00am-10:50am · CENTR 115"; "TBA" when no time is known. */
export function formatMeetings(meetings: CatalogSection['meetings']): string[] {
  if (meetings.length === 0) return ['TBA']
  return meetings.map(m => {
    if (m.days === null || m.start === null || m.end === null) return 'TBA'
    const time = `${m.days} ${formatClockWithSuffix(m.start, false)}–${formatClockWithSuffix(m.end, false)}`
    const place = m.bldg ? ` · ${m.bldg}${m.room ? ` ${m.room}` : ''}` : ''
    return `${time}${place}`
  })
}

/** "630" -> "6:30p" (short) or "6:30pm" (long); meridiem suffix toggleable */
function formatClockWithSuffix(min: number, shortSuffix: boolean = true): string {
  const hours = Math.floor(min / 60)
  const mins = min % 60
  const period = shortSuffix ? (hours < 12 ? 'a' : 'p') : (hours < 12 ? 'am' : 'pm')
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${String(mins).padStart(2, '0')}${period}`
}

/** "MWF" -> "MWF"; null -> "TBA" */
export function formatDays(days: string | null): string {
  return days ?? 'TBA'
}

/** start/end minutes -> "6:30p–7:20p"; "TBA" when either is missing */
export function formatTime(start: number | null, end: number | null): string {
  if (start === null || end === null) return 'TBA'
  return `${formatClockWithSuffix(start)}–${formatClockWithSuffix(end)}`
}

const DAY_ORDER = ['Sun', 'M', 'Tu', 'W', 'Th', 'F', 'S']
const DAY_TOKEN_RE = /Sun|Tu|Th|M|W|F|S/g

/** Earliest weekday index found in a meeting's days string; TBA/unknown sorts last. */
export function dayRank(days: string | null): number {
  if (!days) return DAY_ORDER.length
  const tokens = days.match(DAY_TOKEN_RE) ?? []
  const ranks = tokens.map(t => DAY_ORDER.indexOf(t)).filter(r => r >= 0)
  return ranks.length ? Math.min(...ranks) : DAY_ORDER.length
}

export type SeatChip = { label: string; variant: 'open' | 'full' | 'unlim' | 'cancelled' }

export function seatChip(section: Pick<CatalogSection, 'cancelled' | 'cap' | 'avail' | 'wait'>): SeatChip {
  if (section.cancelled) return { label: 'Cancelled', variant: 'cancelled' }
  if (section.cap === null) return { label: 'Unlimited', variant: 'unlim' }
  if (section.avail !== null && section.avail > 0) return { label: `Open ${section.avail}/${section.cap}`, variant: 'open' }
  return { label: `FULL WL ${section.wait ?? 0}`, variant: 'full' }
}

export const SEAT_CHIP_CLASSES: Record<SeatChip['variant'], string> = {
  open: 'bg-seat-open-bg text-seat-open',
  full: 'bg-seat-full-bg text-seat-full',
  unlim: 'bg-seat-unlim-bg text-seat-unlim',
  cancelled: 'bg-seat-cancelled-bg text-seat-cancelled line-through decoration-1'
}

/** Shared jqGrid-cell chrome (spec §1.4/§3.4) — one definition for both
 * CourseAccordion's and ListView's grids so the two tables can't drift apart. */
export const GRID_TH_CLASS = 'wr-grid-header whitespace-nowrap text-left'
export const GRID_TD_CLASS =
  'border-b border-r border-wr-grid-border px-[length:var(--space-wr-cell-x)] py-[length:var(--space-wr-cell-y)] align-top last:border-r-0'
