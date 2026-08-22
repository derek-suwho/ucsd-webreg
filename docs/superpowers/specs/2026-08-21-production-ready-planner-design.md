# Production-Ready WebReg-Style Planner — Design

Status: APPROVED in chat on 2026-08-21. Written-spec review pending.

## Goal

Ship a reliable, accessible planning-only course scheduler that preserves the old WebReg workflow and familiarity without impersonating UC San Diego or modifying official student records.

Live Fall 2026 TSS ingestion is deferred. The release uses sanitized fixture/demo catalog data through the same source interface planned for a future authorized TSS adapter.

## Product Boundary

- Search courses and sections.
- Build, copy, rename, delete, and compare schedules.
- Show list, weekly calendar, finals, seats, and conflicts.
- Persist guest schedules locally and authenticated schedules server-side.
- Never enroll, book, drop, waitlist, authenticate to TSS, or hold UCSD session credentials.
- Match legacy layout, density, terminology, and interaction patterns.
- Use independent product naming, no official UCSD logo, and a prominent `Unofficial planning tool — cannot enroll` notice.
- State fixture/demo data freshness honestly. Never imply that demo data is live.

## Existing Architecture

Keep the npm-workspaces modular monolith:

- `apps/web`: Next.js App Router UI and JSON API.
- `apps/worker`: catalog synchronization process.
- `packages/catalog`: parsing, normalization, persistence, snapshots, and source contracts.
- `packages/planner`: pure family-selection and conflict logic.
- `packages/search`: pure client-side catalog search.
- `packages/config`: validated environment configuration.
- `packages/db`: Prisma/PostgreSQL schema and client.

Do not rewrite working modules. Complete the current uncommitted security/UI hardening and make focused corrections around it.

## Catalog Source Boundary

Add a source-neutral catalog contract. Worker orchestration consumes the contract rather than assuming legacy SoC HTML.

```ts
export interface CatalogSource {
  readonly kind: 'fixture' | 'legacy-soc' | 'tss'
  listTerms(): Promise<SourceTerm[]>
  fetchDepartment(termId: string, department: string): Promise<ScrapedCourse[]>
}
```

Release configuration enables `fixture`. Existing `legacy-soc` remains available only for supported pre-FA26 terms. `tss` exists as a disabled adapter boundary and must not accept passwords, cookies, tokens, or authenticated response captures.

The fixture must:

- be sanitized and contain no student/session data;
- cover lectures, discussions, labs, TBA meetings, finals, cancellations, full/open/unlimited seats, waitlists, variable units, and conflicts;
- carry an explicit generated timestamp and `demo` provenance;
- pass through production normalization and snapshot code.

## Correctness Work

### Planner state

- Select the first valid schedule after authenticated fetch.
- After deleting the active schedule, select another schedule or create a default.
- Never display a phantom `My Schedule` when no active schedule exists.
- Store and hydrate guest schedules by term without rewriting other terms.
- Cache catalog payload with its ETag; never accept a `304` without local payload.
- Represent catalog loading, failure, retry, and stale states explicitly.
- Surface schedule-save failures as unsynced state and retry them.
- Flush pending authenticated saves on page lifecycle boundaries where the platform permits.

### Catalog and worker

- Fatal full-sync failures propagate and produce failed job status.
- Health is true only when the latest required sync succeeded and data is within its freshness threshold.
- Cancel sections from courses absent in a completed department scrape.
- Scope seat queries to the requested term.
- Bound whole-term snapshot size, not only per-department input.
- Add graceful worker shutdown and Prisma/Redis/PostgreSQL cleanup.
- Compile the worker to production JavaScript; never run production through `tsx`.

### API and security

- Finish `loadWebEnv` and consume validated values in Auth.js and request security helpers.
- Require exact production origin on authenticated mutations.
- Use bounded JSON parsing for every mutation, including rename.
- Keep Redis-backed production rate limiting fail-closed.
- Keep nonce CSP and security headers testable and enabled.
- Preserve ownership checks, global schedule quota, term/section referential validation, and generic error responses.

## Frontend Design

Preserve the old WebReg information hierarchy: masthead, term and schedule controls, always-visible search, dense course drawers, List/Calendar/Finals tabs, and compact schedule tables.

Familiarity does not include nonfunctional official controls. Appointment time, enrollment information, booking, book list, and advanced search controls are removed until they have real planning-only behavior.

Required behavior:

- Dynamic term selector backed by `/api/terms`.
- Correct local-versus-account persistence copy.
- Visible catalog provenance and freshness.
- Honest full/open/unlimited/cancelled seat semantics; full sections remain plannable with a clear warning.
- Search autofocus on desktop without forcing mobile keyboards.
- Native or fully conforming accessible schedule selection.
- Keyboard-complete tabs, dialogs, planning, schedule management, and calendar alternatives.
- Touch targets at least 44 CSS pixels where space permits; compact data cells may remain smaller when not interactive.
- Mobile layouts at 320, 375, and 768 CSS pixels without page-level horizontal overflow.
- Data grids may scroll within labeled containers with visible affordances.
- Skip link, reduced-motion support, useful focus states, and print-only schedule output.
- Empty, loading, retryable error, offline/unsynced, and stale-data states.

## Trust and Legal UX

- Independent product name; no UCSD wordmark or official logo asset.
- Unofficial/cannot-enroll notice adjacent to the first UCSD reference and in the footer.
- Privacy page describes Google profile fields, schedules, retention, deletion, cookies, and infrastructure.
- Terms page describes planning-only behavior, data freshness limits, no enrollment authority, and no university endorsement.
- Account deletion removes owned schedules and user profile.
- Export supports a portable JSON schedule backup before deletion.
- Repository license text must match the license claimed in the UI; otherwise remove the claim.
- Launch requires the owner to resolve UCSD name/content/data permissions. Source code cannot satisfy this external gate.

## Deployment

Target Railway, matching the existing approved v1 design.

- Separate web, worker, migration, PostgreSQL, and Redis responsibilities.
- Multi-stage, non-root production images.
- Runtime and migration database roles documented separately.
- TLS Redis/PostgreSQL and exact proxy-hop/origin configuration required in production.
- Liveness reports process health; readiness reports dependency availability; catalog freshness is a separate status signal.
- Structured logs exclude secrets, cookies, response bodies, connection strings, and personal data.
- Graceful SIGTERM handling for web/worker deployment rotation.
- Backup, restoration drill, rollback, secret rotation, incident response, and parser-failure runbooks.
- Fixture-backed release is visibly labeled demo and cannot claim live seat availability.

## Verification

Every implementation slice uses tests first where behavior is testable. Release gates:

1. Clean install on declared Node versions.
2. Clean, non-incremental TypeScript build.
3. Unit and integration tests pass with disposable PostgreSQL and Redis.
4. ESLint passes without warnings.
5. Web and compiled worker production builds pass.
6. Playwright covers guest planning, account persistence, schedule CRUD, conflicts, term switching, retry/error states, export, and deletion.
7. Automated accessibility checks plus keyboard-only manual pass.
8. Two localhost screenshot comparison rounds against archived legacy references at desktop size.
9. Responsive screenshots at 320, 375, 768, and 1440 CSS pixels.
10. Security checks cover origin, CSP, rate limiting, ownership, input bounds, dependency audit, and secret scanning.
11. Worker tests cover failed-sync health, stale-course cancellation, whole-term bounds, lock release, and graceful shutdown.
12. Deployment smoke test verifies migrations, web readiness, worker startup, fixture import, schedule persistence, and rollback procedure.

## Release Definition

The fixture-backed application is release-ready when all repository gates pass and operational documentation is complete. It must be labeled demo wherever seat/catalog recency appears.

Live-data production readiness additionally requires all of:

- sanitized TSS course-response schema;
- documented UCSD authorization to automate and republish the relevant fields;
- approved authentication/service-account design that never uses student session credentials;
- completed `tss` adapter tests and live-data reconciliation;
- monitored freshness and upstream-change alerts.

Until those conditions are met, live TSS synchronization remains disabled by design.
