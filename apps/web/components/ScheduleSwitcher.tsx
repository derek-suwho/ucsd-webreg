'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { plannerStore, type PlannerSchedule } from '@/lib/store'
import { useFocusTrap } from '@/lib/use-focus-trap'

type ScheduleAction =
  | { type: 'new'; value: string }
  | { type: 'copy' | 'rename'; target: Pick<PlannerSchedule, 'id' | 'name'>; value: string }
  | { type: 'delete'; target: Pick<PlannerSchedule, 'id' | 'name'> }

const CONTROL_CLASS =
  'wr-btn min-h-11 shrink-0 disabled:cursor-not-allowed disabled:opacity-50'

export default function ScheduleSwitcher() {
  const schedules = useStore(plannerStore, state => state.schedules)
  const activeScheduleId = useStore(plannerStore, state => state.activeScheduleId)
  const lastError = useStore(plannerStore, state => state.lastError)
  const [action, setAction] = useState<ScheduleAction | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const activeSchedule = schedules.find(schedule => schedule.id === activeScheduleId) ?? null

  function openAction(type: ScheduleAction['type']) {
    plannerStore.getState().clearError()
    if (type === 'new') {
      setAction({ type, value: '' })
      return
    }
    if (!activeSchedule) return
    const target = { id: activeSchedule.id, name: activeSchedule.name }
    if (type === 'delete') setAction({ type, target })
    else setAction({ type, target, value: type === 'copy' ? `${target.name} copy` : target.name })
  }

  function dismissAction() {
    if (!busyRef.current) setAction(null)
  }

  async function submitAction(value?: string) {
    if (!action || busyRef.current) return
    const name = value?.trim()
    if (action.type !== 'delete' && !name) return

    busyRef.current = true
    setBusy(true)
    plannerStore.getState().clearError()
    try {
      if (action.type === 'new') await plannerStore.getState().createSchedule(name as string)
      else if (action.type === 'copy') await plannerStore.getState().copySchedule(action.target.id, name as string)
      else if (action.type === 'rename') await plannerStore.getState().renameSchedule(action.target.id, name as string)
      else await plannerStore.getState().deleteSchedule(action.target.id)

      if (!plannerStore.getState().lastError) setAction(null)
    } catch {
      plannerStore.setState({ lastError: 'Schedule action failed' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <div data-schedule-controls className="flex items-center gap-1.5">
        <label htmlFor="active-schedule" className="sr-only">
          Active schedule
        </label>
        <select
          id="active-schedule"
          aria-label="Active schedule"
          value={activeSchedule?.id ?? ''}
          disabled={schedules.length === 0}
          onChange={event => plannerStore.getState().setActive(event.target.value)}
          className="min-h-11 w-[253px] rounded-[3px] border border-[#999999] bg-white px-2 text-[13px] text-ink disabled:cursor-not-allowed disabled:bg-[#f0f0f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wr-header-accent"
        >
          {schedules.length === 0 && <option value="">No schedules</option>}
          {schedules.map(schedule => (
            <option key={schedule.id} value={schedule.id}>
              {schedule.name}
            </option>
          ))}
        </select>
        <button type="button" className={CONTROL_CLASS} onClick={() => openAction('new')}>
          New
        </button>
        <button type="button" className={CONTROL_CLASS} disabled={!activeSchedule} onClick={() => openAction('copy')}>
          Copy
        </button>
        <button type="button" className={CONTROL_CLASS} disabled={!activeSchedule} onClick={() => openAction('rename')}>
          Rename
        </button>
        <button type="button" className={CONTROL_CLASS} disabled={!activeSchedule} onClick={() => openAction('delete')}>
          Delete
        </button>
      </div>

      {action && (
        <ScheduleActionDialog
          action={action}
          busy={busy}
          error={lastError}
          onChange={value => setAction(current => {
            if (!current || current.type === 'delete') return current
            return { ...current, value }
          })}
          onCancel={dismissAction}
          onSubmit={submitAction}
        />
      )}
    </>
  )
}

function ScheduleActionDialog({
  action,
  busy,
  error,
  onChange,
  onCancel,
  onSubmit
}: {
  action: ScheduleAction
  busy: boolean
  error: string | null
  onChange: (value: string) => void
  onCancel: () => void
  onSubmit: (value?: string) => Promise<void>
}) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useFocusTrap(dialogRef, onCancel)

  useEffect(() => {
    if (action.type === 'delete') cancelRef.current?.focus()
    else inputRef.current?.focus()
  }, [action.type])

  const title = action.type === 'new'
    ? 'New schedule'
    : action.type === 'copy'
      ? `Copy ${action.target.name}`
      : action.type === 'rename'
        ? `Rename ${action.target.name}`
        : `Delete ${action.target.name}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--shadow-wr-overlay)] p-4" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-sm overflow-hidden rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-wr-ui-content-bg text-[length:var(--font-size-wr-base)] text-ink shadow-[var(--shadow-wr-dialog)]"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex min-h-11 items-center justify-between gap-2 border-b border-wr-th-border bg-gradient-to-b from-wr-th-from to-wr-th-to px-3">
          <h2 id={titleId} className="text-[13px] font-bold text-wr-ui-header-text">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onCancel}
            className="wr-dialog-close min-h-11 min-w-11 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true" className="text-sm font-bold">×</span>
          </button>
        </div>

        <form
          onSubmit={event => {
            event.preventDefault()
            void onSubmit(action.type === 'delete' ? undefined : action.value)
          }}
        >
          <div className="px-3 py-3">
            {action.type === 'delete' ? (
              <p id={descriptionId}>Delete “{action.target.name}”? This cannot be undone.</p>
            ) : (
              <div className="grid gap-2">
                <label htmlFor="schedule-name" className="font-medium">
                  Schedule name
                </label>
                <input
                  ref={inputRef}
                  id="schedule-name"
                  name="schedule-name"
                  value={action.value}
                  required
                  maxLength={60}
                  disabled={busy}
                  onChange={event => onChange(event.target.value)}
                  className="min-h-11 w-full rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-white px-2 text-ink disabled:cursor-not-allowed disabled:bg-[#f0f0f0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-wr-header-accent"
                />
                <p id={descriptionId} className="text-[length:var(--font-size-wr-small)] text-ink-muted">
                  Enter 1–60 characters.
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-2 text-wr-ui-error-text">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-wr-ui-content-border px-3 py-2">
            <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className={CONTROL_CLASS}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (action.type !== 'delete' && action.value.trim().length === 0)}
              className={CONTROL_CLASS}
            >
              {action.type === 'new' ? 'Create' : action.type === 'rename' ? 'Save' : action.type === 'copy' ? 'Copy' : 'Delete'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
