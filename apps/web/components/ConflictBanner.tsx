'use client'

import { useStore } from 'zustand'
import type { CatalogData } from '@webreg/catalog'
import type { Conflict } from '@webreg/planner'
import { plannerStore } from '@/lib/store'

function sectionLabel(catalog: CatalogData, sectionId: string): string {
  const section = catalog.sections[sectionId]
  if (!section) return 'an unknown section'
  const course = catalog.courses[section.courseId]
  if (!course) return section.code
  return `${course.subject} ${course.number} ${section.code}`
}

function conflictSentence(catalog: CatalogData, conflict: Conflict): string {
  const a = sectionLabel(catalog, conflict.a)
  const b = sectionLabel(catalog, conflict.b)
  if (conflict.kind === 'meeting') {
    return `${a} conflicts with ${b}${conflict.day ? ` on ${conflict.day}` : ''}`
  }
  return `${a} exam overlaps with ${b}${conflict.date ? ` on ${conflict.date}` : ''}`
}

export default function ConflictBanner({ conflicts }: { conflicts: Conflict[] }) {
  const catalog = useStore(plannerStore, s => s.catalog)

  if (!catalog || conflicts.length === 0) return null

  return (
    <div
      role="alert"
      className="mb-3 rounded-[var(--radius-wr-corner)] border border-wr-ui-error-border bg-wr-ui-error-bg px-3 py-2 text-[12px] leading-[1.3] text-wr-ui-error-text"
    >
      <p className="mb-1 font-bold">
        {conflicts.length === 1 ? 'You have a scheduling conflict!' : 'You have scheduling conflicts!'}
      </p>
      <ul className="space-y-0.5">
        {conflicts.map((c, i) => (
          <li key={`${c.a}-${c.b}-${c.kind}-${c.day ?? c.date ?? i}`}>{conflictSentence(catalog, c)}</li>
        ))}
      </ul>
      <p className="mt-1.5 border-t border-wr-ui-error-border/40 pt-1.5">
        These planning-only warnings do not change registration. This planner cannot enroll or drop courses. Verify
        all meeting and exam details in the official UC San Diego system before registering.
      </p>
    </div>
  )
}
