import type { CatalogData } from '@webreg/catalog'
import type { Conflict } from './types.js'

const DAY_TOKEN_RE = /Sun|T[uh]|[MWFS]/g

function tokenizeDays(days: string): string[] {
  return days.match(DAY_TOKEN_RE) ?? []
}

function timesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

export function findConflicts(sectionIds: string[], catalog: CatalogData): Conflict[] {
  const conflicts: Conflict[] = []

  const meetingEntries: { sectionId: string; days: string[]; start: number; end: number }[] = []
  const examEntries: { sectionId: string; date: string; start: number; end: number }[] = []

  for (const sectionId of sectionIds) {
    const section = catalog.sections[sectionId]
    if (!section) continue
    for (const m of section.meetings) {
      if (m.days === null || m.start === null || m.end === null) continue
      meetingEntries.push({ sectionId, days: tokenizeDays(m.days), start: m.start, end: m.end })
    }
    for (const e of section.exams) {
      examEntries.push({ sectionId, date: e.date, start: e.start, end: e.end })
    }
  }

  for (let i = 0; i < meetingEntries.length; i++) {
    for (let j = i + 1; j < meetingEntries.length; j++) {
      const x = meetingEntries[i]
      const y = meetingEntries[j]
      if (x.sectionId === y.sectionId) continue
      const day = x.days.find(d => y.days.includes(d))
      if (!day) continue
      if (timesOverlap(x.start, x.end, y.start, y.end)) {
        conflicts.push({ a: x.sectionId, b: y.sectionId, kind: 'meeting', day })
      }
    }
  }

  for (let i = 0; i < examEntries.length; i++) {
    for (let j = i + 1; j < examEntries.length; j++) {
      const x = examEntries[i]
      const y = examEntries[j]
      if (x.sectionId === y.sectionId) continue
      if (x.date !== y.date) continue
      if (timesOverlap(x.start, x.end, y.start, y.end)) {
        conflicts.push({ a: x.sectionId, b: y.sectionId, kind: 'exam', date: x.date })
      }
    }
  }

  return conflicts
}
