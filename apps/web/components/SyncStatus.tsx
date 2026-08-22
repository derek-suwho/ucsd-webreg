'use client'

import { useStore } from 'zustand'
import { plannerStore } from '@/lib/store'

export default function SyncStatus({ scheduleId }: { scheduleId: string | null }) {
  const authed = useStore(plannerStore, state => state.authed)
  const status = useStore(plannerStore, state => scheduleId ? state.scheduleSync[scheduleId] : undefined)

  if (!authed || !scheduleId || !status) return null

  return (
    <span aria-live="polite" className="text-[11px] text-ink-muted">
      {status === 'pending' && 'Saving…'}
      {status === 'saved' && 'Saved'}
      {status === 'failed' && (
        <>
          Couldn’t save —{' '}
          <button
            type="button"
            onClick={() => void plannerStore.getState().retryScheduleSave(scheduleId)}
            className="font-semibold text-wr-link underline-offset-2 hover:underline active:opacity-70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
          >
            Retry
          </button>
        </>
      )}
    </span>
  )
}
