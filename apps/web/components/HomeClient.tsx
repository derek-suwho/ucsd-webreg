'use client'

import { useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import { findConflicts } from '@webreg/planner'
import { plannerStore } from '@/lib/store'
import * as guestStorage from '@/lib/guest-storage'
import SearchPane from '@/components/SearchPane'
import TabBar, { tabPanelId, type ScheduleTab } from '@/components/TabBar'
import ListView from '@/components/ListView'
import CalendarView from '@/components/CalendarView'
import FinalsView from '@/components/FinalsView'
import ConflictBanner from '@/components/ConflictBanner'
import ScheduleSwitcher from '@/components/ScheduleSwitcher'
import ImportGuestDialog from '@/components/ImportGuestDialog'
import SyncStatus from '@/components/SyncStatus'
import CatalogStatus from '@/components/CatalogStatus'

export default function HomeClient({ authed }: { authed: boolean }) {
  const termId = useStore(plannerStore, s => s.termId)
  const terms = useStore(plannerStore, s => s.terms)
  const termsStatus = useStore(plannerStore, s => s.termsStatus)
  const termsError = useStore(plannerStore, s => s.termsError)
  const catalog = useStore(plannerStore, s => s.catalog)
  const catalogStatus = useStore(plannerStore, s => s.catalogStatus)
  const catalogError = useStore(plannerStore, s => s.catalogError)
  const schedules = useStore(plannerStore, s => s.schedules)
  const activeScheduleId = useStore(plannerStore, s => s.activeScheduleId)
  const lastError = useStore(plannerStore, s => s.lastError)
  const [activeTab, setActiveTab] = useState<ScheduleTab>('list')

  // Set auth first so the selected term hydrates the correct persistence boundary.
  useEffect(() => {
    plannerStore.getState().setAuthed(authed)
  }, [authed])

  useEffect(() => {
    void plannerStore.getState().loadTerms()
  }, [])

  useEffect(() => {
    const flush = () => {
      void plannerStore.getState().flushPendingSaves()
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }

    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  // Guests land with no schedule yet — create a default one so Plan works immediately.
  // Skipped while an authed user still has unresolved local guest data: ImportGuestDialog
  // gets first say (import vs discard) before we invent a fresh empty schedule.
  useEffect(() => {
    if (termsStatus !== 'ready' || catalogStatus !== 'ready' || !termId || schedules.length > 0) return
    if (authed && guestStorage.hasSchedulesForTerm(termId)) return
    plannerStore.getState().createSchedule('My Schedule')
  }, [termId, termsStatus, catalogStatus, schedules.length, authed])

  const activeSchedule = schedules.find(s => s.id === activeScheduleId)
  const activeTerm = terms.find(term => term.id === termId)
  const scrollBehavior = () => (
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth'
  ) satisfies ScrollBehavior

  // Computed once here (not duplicated per-consumer) so ConflictBanner, CalendarView, and FinalsView always agree.
  const conflicts = useMemo(() => {
    if (!catalog) return []
    const sectionIds = activeSchedule?.sectionIds ?? []
    return findConflicts(sectionIds.filter(id => catalog.sections[id]), catalog)
  }, [catalog, activeSchedule])

  return (
    <div className="flex flex-1 flex-col bg-white">
      <div className="planner-print-hidden">
        <ImportGuestDialog authed={authed} />
      </div>

      <section aria-label="Printed schedule identity" className="print-only">
        <h1>Course Planner</h1>
        <p>Term: {activeTerm?.name ?? 'No term selected'}</p>
        <p>Schedule: {activeSchedule?.name ?? 'No active schedule'}</p>
        <CatalogStatus
          status={catalogStatus}
          error={catalogError}
          provenance={catalog?.provenance ?? null}
          generatedAt={catalog?.generatedAt ?? null}
          onRetry={() => {}}
        />
        <p>Unofficial planning tool — cannot enroll</p>
      </section>

      {lastError && (
        <div className="planner-print-hidden flex items-center justify-between gap-3 border-b border-wr-ui-error-border bg-white px-5 py-2 text-[length:var(--font-size-wr-small)] text-wr-ui-error-text">
          <span>{lastError}</span>
          <button
            type="button"
            onClick={() => plannerStore.getState().clearError()}
            className="rounded-[var(--radius-wr-corner)] px-2 py-0.5 text-[11px] font-medium transition-[background-color] hover:bg-black/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-ui-error-text"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Reference layout (reference-image-spec.md §2): centered content column on
          white — title row, intro line, search, schedule switcher, then a fused
          navy tab strip + table. Replaces the old dark term strip entirely. */}
      <div className="planner-content mx-auto w-full max-w-[1120px] flex-1 px-4 pb-6">
        {/* Title row (spec §2.4) — app title left, API-backed term picker right. */}
        <div className="planner-print-hidden planner-title-row flex flex-wrap items-end justify-between gap-3 pt-[32px]">
          <h1 className="text-[27px] font-bold text-wr-orange">Course Planner</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <select
              aria-label="Academic term"
              value={termId ?? ''}
              disabled={termsStatus === 'loading' || terms.length === 0}
              onChange={event => void plannerStore.getState().loadTerm(event.target.value)}
              className="planner-term-select w-[253px] max-w-full rounded-[3px] border border-[#999999] bg-white px-1.5 py-1 text-[13px] text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
            >
              {terms.map(term => <option key={term.id} value={term.id}>{term.name}</option>)}
            </select>
          </div>
        </div>

        <p className="planner-print-hidden mt-2 text-[13px] text-[#3d3d3d]">
          Plan your courses — build and compare schedules.{' '}
          {authed ? 'Schedules are saved to your account.' : 'Schedules are saved in this browser.'}
        </p>

        <div className="planner-print-hidden mt-1 min-h-5 text-[12px] text-[#555555]">
          {termsStatus === 'loading' && <p role="status">Loading academic terms…</p>}
          {termsStatus === 'error' && (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-wr-ui-error-text">
              <span>{termsError}</span>
              <button
                type="button"
                onClick={() => void plannerStore.getState().loadTerms()}
                className="font-bold text-wr-link hover:underline active:translate-y-px focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
              >
                Retry terms
              </button>
            </p>
          )}
          {termsStatus === 'ready' && terms.length === 0 && <p>No academic terms available.</p>}
        </div>

        <div className="planner-print-hidden">
          <CatalogStatus
            status={catalogStatus}
            error={catalogError}
            provenance={catalog?.provenance ?? null}
            generatedAt={catalog?.generatedAt ?? null}
            onRetry={() => {
              if (termId) void plannerStore.getState().loadTerm(termId)
            }}
          />
        </div>

        <section aria-label="Search results" className="planner-search mt-[36px]">
          <SearchPane />
        </section>

        <div className="planner-schedule-actions mt-[32px] flex flex-wrap items-center justify-end gap-2">
          <span className="text-[14px] font-bold text-ink">My schedule:</span>
          <ScheduleSwitcher />
          <SyncStatus scheduleId={activeScheduleId} />
        </div>

        {/* Tab strip fused to the table below it (spec §2.8/§2.9). TabBar renders
            only the tab buttons; this bar supplies the navy background/height and
            the right-side print action. The table sits flush underneath
            (no gap, no extra padding wrapper) so the active white tab visually
            joins it. */}
        <section aria-label="Schedule view" className="mt-[10px]">
          <div className="planner-tab-strip flex min-h-8 flex-wrap items-end justify-between gap-3 bg-wr-tabbar px-3">
            <TabBar active={activeTab} onChange={setActiveTab} />
            <div className="flex shrink-0 items-center pb-1.5 text-[13px] font-bold text-white">
              <button
                type="button"
                onClick={() => window.print()}
                className="hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Print Schedule
              </button>
            </div>
          </div>

          <div className="border-2 border-t-0 border-wr-tabbar bg-white">
            <div
              id={tabPanelId('list')}
              role="tabpanel"
              aria-labelledby="tab-list"
              aria-hidden={activeTab !== 'list'}
              data-print-canonical="true"
              className={`planner-list-panel ${activeTab !== 'list' ? 'hidden' : ''}`}
            >
              <ListView />
            </div>
            <div
              id={tabPanelId('calendar')}
              role="tabpanel"
              aria-labelledby="tab-calendar"
              aria-hidden={activeTab !== 'calendar'}
              className={`p-3 ${activeTab !== 'calendar' ? 'hidden' : ''}`}
            >
              <ConflictBanner conflicts={conflicts} />
              <CalendarView conflicts={conflicts} />
            </div>
            <div
              id={tabPanelId('finals')}
              role="tabpanel"
              aria-labelledby="tab-finals"
              aria-hidden={activeTab !== 'finals'}
              className={`p-3 ${activeTab !== 'finals' ? 'hidden' : ''}`}
            >
              <ConflictBanner conflicts={conflicts.filter(c => c.kind === 'exam')} />
              <FinalsView conflicts={conflicts} />
            </div>
          </div>
        </section>

        {/* Right-edge floater (spec §2.11) — scroll-to-top / scroll-to-bottom chevrons,
            fixed to the viewport's right edge around the tab-strip area. */}
        <div className="planner-scroll-controls fixed right-4 top-[360px] z-20 flex flex-col gap-4">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: scrollBehavior() })}
            aria-label="Scroll to top"
            className="flex h-6 w-6 items-center justify-center text-[#555555] transition-transform hover:scale-110 active:scale-95 focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: scrollBehavior() })}
            aria-label="Scroll to bottom"
            className="flex h-6 w-6 items-center justify-center text-[#555555] transition-transform hover:scale-110 active:scale-95 focus-visible:outline focus-visible:outline-1 focus-visible:outline-dotted focus-visible:outline-offset-2 focus-visible:outline-wr-header-band"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
