'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { plannerStore, shouldOfferImport } from '@/lib/store'
import * as guestStorage from '@/lib/guest-storage'
import { useFocusTrap } from '@/lib/use-focus-trap'

/** Shows once per authed session load: offers to bring locally-saved (guest) schedules onto the account. */
export default function ImportGuestDialog({ authed }: { authed: boolean }) {
  const termId = useStore(plannerStore, s => s.termId)
  const [offer, setOffer] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const checkedRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!authed || !termId || checkedRef.current) return
    checkedRef.current = true

    const guest = guestStorage.load()
    if (!guest || guest.schedules.length === 0) return
    let current = true
    queueMicrotask(() => {
      if (current && shouldOfferImport(guest)) setOffer(true)
    })
    return () => { current = false }
  }, [authed, termId])

  async function ensureAccountSchedule(refresh: boolean) {
    if (refresh) await plannerStore.getState().refetchSchedules()
    const state = plannerStore.getState()
    if (state.authed && state.termId === termId && state.schedules.length === 0) {
      await state.createSchedule('My Schedule')
    }
  }

  function finishAccountSetup(refresh: boolean) {
    void ensureAccountSchedule(refresh).catch(() => {
      plannerStore.setState({ lastError: 'Could not finish account schedule setup. Try again.' })
    })
  }

  function dismiss() {
    if (busyRef.current) return
    setOffer(false)
    finishAccountSetup(true)
  }

  function handleDiscard() {
    if (busyRef.current) return
    guestStorage.clear()
    setOffer(false)
    finishAccountSetup(true)
  }

  async function handleImport() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await plannerStore.getState().importGuestSchedules()
      if ((guestStorage.load()?.schedules.length ?? 0) > 0) return
      await ensureAccountSchedule(false)
      setOffer(false)
    } catch {
      plannerStore.setState({ lastError: 'Import failed' }) // keep dialog open for retry
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  useFocusTrap(dialogRef, dismiss, offer)

  if (!offer) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--shadow-wr-overlay)] p-4" onClick={dismiss}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby={titleId}
        className="w-full max-w-sm overflow-hidden rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-wr-ui-content-bg text-[length:var(--font-size-wr-base)] text-ink shadow-[var(--shadow-wr-dialog)]"
        onClick={e => e.stopPropagation()}
      >
        {/* Title bar — jQuery UI "Smoothness" .ui-dialog-titlebar, matching ConfirmPlanDialog (spec §3.7). */}
        <div className="flex items-center justify-between gap-2 border-b border-wr-th-border bg-gradient-to-b from-wr-th-from to-wr-th-to px-3 py-2">
          <h2 id={titleId} className="text-[length:var(--font-size-wr-heading)] font-bold text-wr-ui-header-text">
            Import your local schedules?
          </h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            disabled={busy}
            className="wr-dialog-close min-h-11 min-w-11"
          >
            <span aria-hidden="true" className="text-sm font-bold">
              ×
            </span>
          </button>
        </div>

        <div className="px-3 py-3">
          <p className="text-[length:var(--font-size-wr-small)] text-ink-muted">
            You made schedules before signing in. Bring them into your account, or discard them and start fresh.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-wr-ui-content-border bg-wr-ui-content-bg px-3 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleDiscard}
            className="wr-btn min-h-11 min-w-11 disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleImport}
            className="wr-btn min-h-11 min-w-11 disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}
