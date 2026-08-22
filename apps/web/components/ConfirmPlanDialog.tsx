'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { CatalogCourse, CatalogSection } from '@webreg/catalog'
import { formatMeetings, seatChip, SEAT_CHIP_CLASSES } from '@/lib/format'
import { useFocusTrap } from '@/lib/use-focus-trap'

type ConfirmPlanDialogProps = {
  course: CatalogCourse
  family: string
  sections: CatalogSection[]
  onConfirm: (sectionId: string) => void
  onCancel: () => void
}

export default function ConfirmPlanDialog({ course, family, sections, onConfirm, onCancel }: ConfirmPlanDialogProps) {
  const [chosen, setChosen] = useState(sections[0]?.id ?? '')
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstOptionRef = useRef<HTMLInputElement>(null)

  useFocusTrap(dialogRef, onCancel)

  useEffect(() => {
    firstOptionRef.current?.focus()
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--shadow-wr-overlay)] p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-wr-ui-content-bg text-[length:var(--font-size-wr-base)] text-ink shadow-[var(--shadow-wr-dialog)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Title bar (reference-image-spec.md §2 item 9 chrome, applied to dialog titlebars
            too): #e8e8e8→#d7d7d7 gradient, 1px #c8c8c8 border, bold 13px #000 title + close X */}
        <div className="flex items-center justify-between gap-2 border-b border-wr-th-border bg-gradient-to-b from-wr-th-from to-wr-th-to px-3 py-2">
          <h2 id={titleId} className="text-[13px] font-bold text-wr-ui-header-text">
            Choose a section — {course.subject} {course.number}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="wr-dialog-close min-h-11 min-w-11"
          >
            <span aria-hidden="true" className="text-sm font-bold">
              ×
            </span>
          </button>
        </div>
        <p className="border-b border-wr-ui-content-border px-3 py-1.5 text-[length:var(--font-size-wr-small)] text-ink-muted">
          Section {family} has multiple options. Pick one.
        </p>

        <fieldset className="max-h-80 overflow-y-auto px-3 py-2">
          <legend className="sr-only">Available sections for group {family}</legend>
          {sections.map((section, i) => {
            const chip = seatChip(section)
            return (
              <label
                key={section.id}
                className="flex min-h-11 cursor-pointer items-start gap-2 rounded-[var(--radius-wr-corner)] p-1.5 hover:bg-wr-row-hover has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-wr-header-accent has-[:focus-visible]:outline-offset-2"
              >
                <input
                  ref={i === 0 ? firstOptionRef : undefined}
                  type="radio"
                  name="section-choice"
                  value={section.id}
                  checked={chosen === section.id}
                  onChange={() => setChosen(section.id)}
                  className="mt-1 h-3.5 w-3.5 accent-navy-700"
                />
                <span className="flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">{section.code}</span>
                    <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${SEAT_CHIP_CLASSES[chip.variant]}`}>
                      {chip.label}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[length:var(--font-size-wr-small)] text-ink-muted">
                    {formatMeetings(section.meetings).join(' · ')}
                  </span>
                  {section.instructor && (
                    <span className="block text-[length:var(--font-size-wr-small)] text-ink-muted">{section.instructor}</span>
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>

        {/* Button row bottom-right, uniform Smoothness .ui-state-default chrome for both
            Cancel and Confirm — legacy jQuery UI dialogs never color-differentiate a
            "primary" button (spec §3.7). */}
        <div className="flex justify-end gap-2 border-t border-wr-ui-content-border bg-wr-ui-content-bg px-3 py-2">
          <button type="button" onClick={onCancel} className="wr-btn min-h-11 min-w-11">
            Cancel
          </button>
          <button type="button" disabled={!chosen} onClick={() => chosen && onConfirm(chosen)} className="wr-btn min-h-11 min-w-11 disabled:opacity-50">
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
