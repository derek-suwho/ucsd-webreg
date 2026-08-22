import * as cheerio from 'cheerio'
import { parseDays, parseTimeRange, parseUnits } from './time.js'
import type { ParsedRow } from './types.js'

type NoteState =
  | { type: 'none' }
  | { type: 'expect-note'; number: string }
  | { type: 'note'; number: string; content: string }
  | { type: 'note-taken' }

const PAGE_COUNT_RE = /\(\d+\s+of\s+(\d+)\)/
const UNIT_BLOCK_RE = /\(\s*\d+(?:\.5)?(?:\s*[/-]\s*\d+(?:\s*by\s*\d+(?:\.5)?)?)?\s*Units\)/
const norm = (s: string): string => s.trim().replace(/\s+/g, ' ')

/**
 * Parses a "seats available" / "seats limit" cell pair into structured
 * fields. `Unlim` -> unlimited (nulls). `FULL Waitlist(N)` -> full with N
 * waitlisted. Blank (no registration number on the row) -> nulls. Otherwise
 * a plain integer.
 */
export function parseSeatCell(
  availText: string,
  limitText: string
): { available: number | null; capacity: number | null; waitlisted: number | null } {
  const avail = availText.trim()
  if (avail === '' || avail === 'Unlim') {
    return { available: null, capacity: null, waitlisted: null }
  }
  if (avail.includes('FULL')) {
    const m = avail.match(/\((\d+)\)/)
    if (!m) throw new SyntaxError(`Cannot get waitlist count from "${avail}"`)
    return { available: 0, capacity: Number(limitText.trim()), waitlisted: Number(m[1]) }
  }
  const n = Number(avail)
  if (!Number.isFinite(n)) throw new RangeError(`Bad seats available: "${avail}"`)
  return { available: n, capacity: Number(limitText.trim()), waitlisted: null }
}

function parseUsDate(usDate: string): string {
  const m = usDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) throw new SyntaxError(`Bad date: "${usDate}"`)
  const [, month, day, year] = m
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function cellsOf($: cheerio.CheerioAPI, row: any): string[] {
  return $(row)
    .children('td')
    .toArray()
    .map(td => norm($(td).text()))
}

function instructorsOf($: cheerio.CheerioAPI, row: any, cellIndex: number | null): string[] {
  if (cellIndex === null) return []
  const cell = $(row).children('td').eq(cellIndex)
  return cell
    .find('a')
    .toArray()
    .map(a => {
      const [last, first] = norm($(a).text()).split(',').map(s => s.trim())
      return `${first} ${last}`
    })
}

interface SectionFields {
  registrationNumber: number | null
  meetingType: string
  sectionCodeOrDate: string
  days: string
  time: string
  building: string
  room: string
  instructors: string[]
  seatsAvailable: string
  seatsLimit: string
}

/** Reads the purple/white section row's cells into a common shape per the cell-count dispatch rules. */
function extractSectionFields(
  $: cheerio.CheerioAPI, row: any, isSectxt: boolean, cellCount: number, cells: string[]
): SectionFields {
  const regNum = (i: number): number | null => (cells[i] ? Number(cells[i]) : null)
  if (isSectxt && cellCount === 13) {
    return { registrationNumber: regNum(2), meetingType: cells[3], sectionCodeOrDate: cells[4], days: cells[5],
      time: cells[6], building: cells[7], room: cells[8], instructors: instructorsOf($, row, 9),
      seatsAvailable: cells[10], seatsLimit: cells[11] }
  }
  if (isSectxt && cellCount === 10) {
    return { registrationNumber: regNum(2), meetingType: cells[3], sectionCodeOrDate: cells[4], days: cells[5],
      time: '', building: 'TBA', room: '', instructors: instructorsOf($, row, 6),
      seatsAvailable: cells[7], seatsLimit: cells[8] }
  }
  if (isSectxt && cellCount === 6) {
    return { registrationNumber: regNum(2), meetingType: cells[3], sectionCodeOrDate: cells[4], days: cells[5],
      time: '', building: '', room: '', instructors: [], seatsAvailable: '', seatsLimit: '' }
  }
  if (isSectxt) throw new RangeError(`This purple section row has ${cellCount} cells.`)
  if (cellCount === 10) {
    return { registrationNumber: null, meetingType: cells[2], sectionCodeOrDate: cells[3], days: cells[4],
      time: cells[5], building: cells[6], room: cells[7], instructors: [],
      seatsAvailable: cells[8], seatsLimit: cells[9] }
  }
  if (cellCount === 5) {
    return { registrationNumber: null, meetingType: cells[2], sectionCodeOrDate: cells[3], days: cells[4],
      time: '', building: '', room: '', instructors: [], seatsAvailable: '', seatsLimit: '' }
  }
  throw new RangeError(`This white section row has ${cellCount} cells.`)
}

function buildSection(fields: SectionFields): ParsedRow {
  const { registrationNumber, meetingType, sectionCodeOrDate, days, time, building, room, instructors } = fields
  if (days === 'Cancelled') {
    return {
      kind: 'section',
      registrationNumber,
      meetingType,
      sectionCode: sectionCodeOrDate.includes('/') ? null : sectionCodeOrDate || null,
      examDate: sectionCodeOrDate.includes('/') ? parseUsDate(sectionCodeOrDate) : null,
      days: null,
      startMin: null,
      endMin: null,
      building: null,
      room: null,
      instructors,
      available: null,
      capacity: null,
      waitlisted: null,
      cancelled: true
    }
  }
  const isExam = sectionCodeOrDate.includes('/')
  const parsedDays = parseDays(days)
  const range = parsedDays !== null ? parseTimeRange(time) : null
  const seats = parseSeatCell(fields.seatsAvailable, fields.seatsLimit)
  return {
    kind: 'section',
    registrationNumber,
    meetingType,
    sectionCode: isExam ? null : sectionCodeOrDate || null,
    examDate: isExam ? parseUsDate(sectionCodeOrDate) : null,
    days: parsedDays,
    startMin: range?.start ?? null,
    endMin: range?.end ?? null,
    building: building === 'TBA' || building === '' ? null : building,
    room: building === 'TBA' || building === '' ? null : room,
    instructors,
    available: seats.available,
    capacity: seats.capacity,
    waitlisted: seats.waitlisted,
    cancelled: false
  }
}

export function parseResultPage(html: string): { rows: ParsedRow[]; pageCount: number } {
  const $ = cheerio.load(html)
  const form = $('#socDisplayCVO')
  if (form.length === 0) throw new Error('Missing results wrapper')

  const pageCountText = form
    .find('td[align="right"]')
    .toArray()
    .map(td => $(td).text())
    .find(t => PAGE_COUNT_RE.test(t))
  const pageMatch = pageCountText?.match(PAGE_COUNT_RE)
  if (!pageMatch) throw new Error('Missing total page count')
  const pageCount = Number(pageMatch[1])

  const tbrdr = form.find('.tbrdr').first()
  if (tbrdr.length === 0) throw new Error('Missing results table')
  const rowsContainer = tbrdr.children().eq(1)
  const trs = rowsContainer.children('tr').toArray()

  const rows: ParsedRow[] = []
  let subject: string | null = null
  let lastNumber: string | null = null
  let noteState: NoteState = { type: 'none' }

  for (const row of trs) {
    const $row = $(row)
    const cellCount = $row.children('td').length
    const hasCrsheader = $row.find('td.crsheader').length > 0
    const isNonenrtxt = $row.hasClass('nonenrtxt')
    const isSectxt = $row.hasClass('sectxt')

    // Reduced course header (precedes a red note).
    if (hasCrsheader && cellCount === 3) {
      const cells = cellsOf($, row)
      if (noteState.type !== 'none') {
        throw new TypeError(`Invalid state '${noteState.type}' for a reduced-info course header.`)
      }
      noteState = { type: 'expect-note', number: cells[1] }
      continue
    }

    // Note row: either a red course note or a black section note already consumed.
    if (isNonenrtxt && cellCount === 2) {
      const cells = cellsOf($, row)
      if (noteState.type === 'expect-note') {
        noteState = { type: 'note', number: noteState.number, content: cells[1] }
      } else if (noteState.type === 'note-taken') {
        noteState = { type: 'none' }
      } else {
        throw new TypeError(`Invalid state '${noteState.type}' for a note.`)
      }
      continue
    } else if (noteState.type === 'expect-note') {
      throw new TypeError('Expected a note after a reduced-info course header.')
    }

    // Subject heading.
    const h2 = $row.find('h2')
    if (h2.length > 0) {
      const heading = norm(h2.text())
      const match = heading.match(/^(.+) \(([A-Z]+) ?\)$/)
      if (match) {
        subject = match[2]
        lastNumber = null
      } else if (heading.endsWith(')')) {
        throw new SyntaxError(`Couldn't parse subject heading:\n${heading}`)
      }
      continue
    }

    // Full course header row.
    if (hasCrsheader && cellCount === 4) {
      if (!subject) throw new Error('No subject')
      const cells = cellsOf($, row)
      const [restrictionText, number, courseInfo] = cells
      const unitBlock = courseInfo.match(UNIT_BLOCK_RE)
      if (!unitBlock) throw new SyntaxError(`Missing "(N units)" in: ${courseInfo}`)
      const title = courseInfo.slice(0, unitBlock.index).trim()
      const description = courseInfo.slice((unitBlock.index ?? 0) + unitBlock[0].length).trim()
      const units = parseUnits(courseInfo)
      const note =
        noteState.type === 'note'
          ? noteState.number === number
            ? noteState.content
            : (() => {
                throw new TypeError(
                  `The note was intended for ${noteState.number} but instead was received by ${number}.`
                )
              })()
          : undefined
      noteState = { type: 'none' }
      rows.push({
        kind: 'course',
        subject,
        number,
        title,
        units,
        restriction: restrictionText ? restrictionText.split(/\s+/) : [],
        note,
        description: description || undefined
      })
      lastNumber = number
      continue
    }

    // Section / exam / extra-meeting row.
    if (isSectxt || isNonenrtxt) {
      if (lastNumber === null) throw new Error('Section does not belong to a course')
      const cells = cellsOf($, row)

      // Check for a trailing black note describing this section.
      let note: string | undefined
      const next = $row.next('tr')
      if (next.length > 0 && next.hasClass('nonenrtxt') && next.children('td').length === 2) {
        noteState = { type: 'note-taken' }
        note = norm(next.children('td').eq(1).text())
      }

      const fields = extractSectionFields($, row, isSectxt, cellCount, cells)
      const parsed = buildSection(fields)
      if (note !== undefined) parsed.note = note
      rows.push(parsed)
      continue
    }

    // Column-header row.
    if ($row.find('td.ubrdr').length > 0) continue

    throw new TypeError(`Unknown row type:\n${norm($.html(row))}`)
  }

  return { rows, pageCount }
}
