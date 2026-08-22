'use client'

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { signOut } from 'next-auth/react'
import { deleteAccount, fetchAccountExport } from '@/lib/api-client'
import { downloadAccountExport } from '@/lib/account-export'
import { plannerStore } from '@/lib/store'
import { useFocusTrap } from '@/lib/use-focus-trap'

const DELETE_CONFIRMATION = 'DELETE'

export default function AccountDataActions() {
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<'delete' | 'signout' | null>(null)
  const [accountDeleted, setAccountDeleted] = useState(false)
  const exportBusyRef = useRef(false)
  const deleteBusyRef = useRef(false)
  const accountDeletedRef = useRef(false)
  const deleteOpenerRef = useRef<HTMLElement | null>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const restoreOpenerRef = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  function dismissDialog() {
    if (deleteBusyRef.current || accountDeletedRef.current) return
    restoreOpenerRef.current = true
    setDialogOpen(false)
    setConfirmation('')
    setDeleteError(null)
  }

  useFocusTrap(dialogRef, dismissDialog, dialogOpen)

  useEffect(() => {
    if (dialogOpen) confirmationRef.current?.focus()
  }, [dialogOpen])

  useEffect(() => {
    if (dialogOpen || !restoreOpenerRef.current) return
    restoreOpenerRef.current = false
    const opener = deleteOpenerRef.current
    if (opener?.isConnected) opener.focus()
    else deleteTriggerRef.current?.focus()
  }, [dialogOpen])

  async function handleExport() {
    if (exportBusyRef.current) return
    exportBusyRef.current = true
    setExportBusy(true)
    setExportError(false)
    try {
      downloadAccountExport(await fetchAccountExport())
    } catch {
      setExportError(true)
    } finally {
      exportBusyRef.current = false
      setExportBusy(false)
    }
  }

  function openDeleteDialog(event: ReactMouseEvent<HTMLButtonElement>) {
    deleteOpenerRef.current = event.currentTarget
    setConfirmation('')
    setDeleteError(null)
    setDialogOpen(true)
  }

  async function retrySignOut() {
    if (deleteBusyRef.current || !accountDeletedRef.current) return
    deleteBusyRef.current = true
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await signOut({ redirectTo: '/' })
      setDialogOpen(false)
    } catch {
      setDeleteError('signout')
    } finally {
      deleteBusyRef.current = false
      setDeleteBusy(false)
    }
  }

  async function handleDelete() {
    if (deleteBusyRef.current || confirmation !== DELETE_CONFIRMATION) return
    deleteBusyRef.current = true
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deleteAccount()
    } catch {
      deleteBusyRef.current = false
      setDeleteBusy(false)
      setDeleteError('delete')
      return
    }

    accountDeletedRef.current = true
    setAccountDeleted(true)
    plannerStore.getState().setAuthed(false)
    try {
      await signOut({ redirectTo: '/' })
      setDialogOpen(false)
    } catch {
      setDeleteError('signout')
    } finally {
      deleteBusyRef.current = false
      setDeleteBusy(false)
    }
  }

  if (dialogOpen) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--shadow-wr-overlay)] p-4"
        onClick={dismissDialog}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-busy={deleteBusy}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="w-full max-w-md overflow-hidden rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-wr-ui-content-bg text-[length:var(--font-size-wr-base)] text-ink shadow-[var(--shadow-wr-dialog)]"
          onClick={event => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2 border-b border-wr-th-border bg-gradient-to-b from-wr-th-from to-wr-th-to px-3 py-2">
            <h2 id={titleId} className="text-[length:var(--font-size-wr-heading)] font-bold text-wr-ui-header-text">
              Delete account
            </h2>
            <button
              type="button"
              aria-label="Close"
              className="wr-dialog-close min-h-[44px] min-w-[44px]"
              disabled={deleteBusy || accountDeleted}
              onClick={dismissDialog}
            >
              <span aria-hidden="true" className="text-sm font-bold">×</span>
            </button>
          </div>

          <div className="space-y-3 px-3 py-3">
            {accountDeleted ? (
              <>
                <p id={descriptionId} className="text-[length:var(--font-size-wr-small)] leading-relaxed text-ink-muted">
                  Your account and saved schedules were deleted. Sign out to finish securing this browser session.
                </p>
                {deleteError === 'signout' && (
                  <p role="alert" className="text-[length:var(--font-size-wr-small)] font-medium text-status-conflict">
                    Account deleted, but sign-out did not finish. Retry sign out.
                  </p>
                )}
              </>
            ) : (
              <>
                <p id={descriptionId} className="text-[length:var(--font-size-wr-small)] leading-relaxed text-ink-muted">
                  This permanently deletes your profile and saved schedules. Type <strong className="text-ink">DELETE</strong> to continue.
                </p>
                <label className="block text-[length:var(--font-size-wr-small)] font-bold text-ink" htmlFor={`${titleId}-confirmation`}>
                  Confirmation
                </label>
                <input
                  ref={confirmationRef}
                  id={`${titleId}-confirmation`}
                  name="confirmation"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  disabled={deleteBusy}
                  onChange={event => setConfirmation(event.target.value)}
                  className="block min-h-[44px] w-full rounded-[var(--radius-wr-corner)] border border-wr-ui-content-border bg-white px-2 py-1.5 text-[length:var(--font-size-wr-base)] text-ink outline-none focus-visible:border-wr-header-accent focus-visible:ring-2 focus-visible:ring-wr-header-accent/30 disabled:opacity-50"
                />
                {deleteError === 'delete' && (
                  <p role="alert" className="text-[length:var(--font-size-wr-small)] font-medium text-status-conflict">
                    Could not delete account. Nothing was deleted; try again.
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-wr-ui-content-border bg-wr-ui-content-bg px-3 py-2">
            {accountDeleted ? (
              <button
                type="button"
                className="wr-btn min-h-[44px] min-w-[44px] disabled:opacity-50"
                disabled={deleteBusy}
                onClick={() => void retrySignOut()}
              >
                {deleteBusy ? 'Signing out…' : 'Retry sign out'}
              </button>
            ) : (
              <>
                <button type="button" className="wr-btn min-h-[44px] min-w-[44px] disabled:opacity-50" disabled={deleteBusy} onClick={dismissDialog}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="wr-btn min-h-[44px] min-w-[44px] disabled:opacity-50"
                  disabled={deleteBusy || confirmation !== DELETE_CONFIRMATION}
                  onClick={() => void handleDelete()}
                >
                  {deleteBusy ? 'Deleting…' : 'Permanently delete account'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (accountDeleted) {
    return (
      <p role="status" className="text-[length:var(--font-size-wr-small)] text-wr-header-text/85">
        Account deleted. Sign-out requested; reload if this page remains open.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="wr-btn min-h-[44px] min-w-[44px] disabled:opacity-50" disabled={exportBusy} onClick={() => void handleExport()}>
        {exportBusy ? 'Exporting…' : 'Export schedules'}
      </button>
      <button ref={deleteTriggerRef} type="button" className="wr-btn min-h-[44px] min-w-[44px]" onClick={openDeleteDialog}>
        Delete account
      </button>
      {exportError && (
        <p role="alert" className="basis-full text-[length:var(--font-size-wr-small)] font-medium text-status-conflict">
          Could not export schedules. Try again.
        </p>
      )}
    </div>
  )
}
