# Planner UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planning state reliable and deliver a responsive, accessible, familiar WebReg-style UI with honest demo/persistence messaging.

**Architecture:** Keep Zustand as the client state boundary. Separate term/catalog lifecycle, schedule persistence state, and presentational components. Server pages provide legal/account routes; APIs remain thin.

**Tech Stack:** React 19, Next.js 16, Zustand, Tailwind CSS 4, dnd-kit, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-production-ready-planner-design.md`

## Global Constraints

- Invoke `design-taste-frontend` before frontend implementation.
- Match archived legacy structure; no new product sections.
- No official UCSD logo/wordmark or implied affiliation.
- All clickable controls have hover, focus-visible, active, and disabled behavior.
- No `transition-all`; mobile-first; respect reduced motion.

---

### Task 1: Term/catalog API cache

**Files:**
- Modify: `apps/web/lib/api-client.ts`
- Create: `apps/web/lib/api-client.test.ts`
- Modify: `apps/web/lib/store.ts`
- Modify: `apps/web/lib/store.test.ts`

**Interfaces:**
- Produces: `listTerms(): Promise<{ terms: ApiTerm[] }>`.
- Changes: `fetchCatalog(termId): Promise<CatalogData>` always returns usable data; a `304` returns cached payload or retries unconditionally.

- [ ] Test separate per-term ETags/payloads, valid `304`, and `304` without payload causing an unconditional retry.
- [ ] Implement payload+ETag cache together and bounded response parsing.
- [ ] Add `terms`, `catalogStatus: 'idle'|'loading'|'ready'|'error'`, and `catalogError` to store.
- [ ] Test `loadTerm` clearing stale search index, selecting term-scoped guest schedules, and exposing retryable errors without unhandled rejection.
- [ ] Run `npx vitest run apps/web/lib/api-client.test.ts apps/web/lib/store.test.ts`.
- [ ] Commit: `web: harden term loading`

### Task 2: Term-scoped schedules and active selection

**Files:**
- Modify: `apps/web/lib/store.ts`
- Modify: `apps/web/lib/store.test.ts`
- Modify: `apps/web/lib/guest-storage.ts`
- Modify: `apps/web/lib/guest-storage.test.ts`

**Interfaces:**
- Planner schedule gains `termId`.
- `setActive(id)` rejects IDs outside current term.
- `refetchSchedules()` selects existing active ID when valid, otherwise first returned schedule.

- [ ] Add tests for multi-term hydration/persistence, authenticated initial fetch, deleting active among multiple schedules, deleting last schedule, and term switch round-trip.
- [ ] Keep a term-keyed guest map in storage and expose only the selected term's schedules in UI state.
- [ ] Ensure guest persistence never rewrites another schedule's term ID.
- [ ] Select deterministic fallback after fetch/delete and create default only when current term truly has none.
- [ ] Run focused guest/store suites.
- [ ] Commit: `web: scope schedules by term`

### Task 3: Reliable authenticated saves

**Files:**
- Modify: `apps/web/lib/store.ts`
- Modify: `apps/web/lib/store.test.ts`
- Modify: `apps/web/components/HomeClient.tsx`
- Create: `apps/web/components/SyncStatus.tsx`

**Interfaces:**
- Produces: per-schedule sync state `'saved'|'pending'|'failed'`.
- Produces: `retryScheduleSave(id): Promise<void>` and `flushPendingSaves(): Promise<void>`.

- [ ] Add fake-timer tests for pending→saved, latest-write wins, failure→retry, two schedules debouncing independently, and lifecycle flush.
- [ ] Replace swallowed PUT rejection with explicit failed state and preserved latest payload.
- [ ] Use `navigator.sendBeacon` only if endpoint semantics can authenticate and validate it; otherwise use `fetch(..., { keepalive: true })` with bounded payload.
- [ ] Render compact `Saving…`, `Saved`, or `Couldn’t save — Retry` status without claiming success early.
- [ ] Run store tests and component smoke test.
- [ ] Commit: `web: make schedule saves reliable`

### Task 4: Dynamic planner shell and honest states

**Files:**
- Modify: `apps/web/components/HomeClient.tsx`
- Modify: `apps/web/components/SearchPane.tsx`
- Modify: `apps/web/components/CourseAccordion.tsx`
- Create: `apps/web/components/CatalogStatus.tsx`
- Create: `apps/web/components/HomeClient.test.tsx`

**Interfaces:**
- Term selector uses `/api/terms` and calls `loadTerm`.
- `CatalogStatus` receives provenance, generated time, loading/error state, and retry callback.

- [ ] Test dynamic terms, retry, demo label, authenticated/local copy, full-but-plannable warning, and removed inert controls.
- [ ] Replace `TERM_ID`/`TERM_LABEL` constants with store-backed selected term and fetched terms.
- [ ] Remove Appointment Time, Enrollment Information, Book List, and Advanced Search until functional.
- [ ] Show `Demo catalog — not live seat data` adjacent to generated time. Never call demo seats “available now.”
- [ ] Make search autofocus desktop-only using a media query and retain keyboard focus semantics.
- [ ] Run component/store tests.
- [ ] Commit: `web: add dynamic term shell`

### Task 5: Accessible schedule and calendar controls

**Files:**
- Modify: `apps/web/components/ScheduleSwitcher.tsx`
- Create: `apps/web/components/ScheduleSwitcher.test.tsx`
- Modify: `apps/web/components/calendar/CalendarView.tsx`
- Modify: `apps/web/components/ListView.tsx`
- Modify: `apps/web/components/TabBar.tsx`

**Interfaces:**
- Use native `<select>` for active schedule plus adjacent explicit New/Copy/Rename/Delete actions.
- Calendar drag actions retain equivalent keyboard buttons.

- [ ] Test schedule selection/actions with keyboard only; verify no nested interactive listbox roles.
- [ ] Expose rename/copy/delete on touch and keyboard, with 44px targets outside dense grids.
- [ ] Add labeled horizontal-scroll regions, sticky course/section identity columns in list/finals tables, and sticky time/day headers in calendar.
- [ ] Verify tabs support arrows/Home/End and calendar swaps/removals have non-drag controls.
- [ ] Run component tests and ESLint.
- [ ] Commit: `web: improve planner accessibility`

### Task 6: Responsive, print, and identity styling

**Files:**
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/components/HomeClient.tsx`
- Create: `serve.mjs`
- Create: `screenshot.mjs`

- [ ] Replace official wordmark/text-logo presentation with independent product name; place `Unofficial planning tool — cannot enroll` beside the first UCSD reference and in footer.
- [ ] Add skip link, responsive wrapping at 320/375/768 widths, reduced-motion rules, and print CSS hiding navigation/search/actions while printing schedule identity and data provenance.
- [ ] Implement `serve.mjs` to serve the built/dev project at `http://localhost:3000` without starting a duplicate listener.
- [ ] Implement `screenshot.mjs` with local Puppeteer, cached Chrome path, auto-incremented `temporary screenshots/screenshot-N[-label].png`, and localhost-only URL validation.
- [ ] Run two desktop comparison rounds against `archive/capture/screenshots/01-term-select.jpg`; record concrete mismatches and corrections.
- [ ] Capture 320, 375, 768, and 1440 screenshots; verify no page-level overflow.
- [ ] Commit: `web: finish responsive legacy shell`

### Task 7: Privacy, export, and account deletion

**Files:**
- Create: `apps/web/app/privacy/page.tsx`
- Create: `apps/web/app/terms/page.tsx`
- Create: `apps/web/app/api/account/export/route.ts`
- Create: `apps/web/app/api/account/route.ts`
- Create: `apps/web/components/AccountActions.tsx`
- Modify: `apps/web/app/layout.tsx`
- Test: `apps/web/tests/api-account.test.ts`

**Interfaces:**
- `GET /api/account/export` returns authenticated portable schedule JSON.
- `DELETE /api/account` deletes schedule items, schedules, then user in one transaction.

- [ ] Add API tests for unauthenticated rejection, ownership-only export, complete deletion, rollback on failure, rate limit, and exact-origin enforcement.
- [ ] Implement bounded export with schema version, generated time, schedules, and section IDs only.
- [ ] Implement transactional deletion and sign-out follow-up UI behind typed confirmation.
- [ ] Write accurate privacy/terms copy from the approved spec; do not claim live data or university endorsement.
- [ ] Add footer links and verify keyboard/focus behavior.
- [ ] Commit: `web: add account privacy controls`

## Unresolved Questions

- Final independent product name. Use `Course Planner` until owner selects one.
