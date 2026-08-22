# Catalog and Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide sanitized demo catalog data through a source-neutral pipeline and make worker failure, reconciliation, bounds, build, and shutdown behavior production-safe.

**Architecture:** Introduce a `CatalogSource` port in `@webreg/catalog`; adapt fixture and legacy SoC inputs behind it. Worker orchestration depends on the port. TSS remains a disabled type boundary.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Zod, Pino, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-production-ready-planner-design.md`

## Global Constraints

- Release source is sanitized fixture data marked `demo`.
- Never accept or store TSS credentials/session material.
- Preserve legacy SoC support only for pre-FA26 terms.
- Tests first; concise commits.

---

### Task 1: Source-neutral catalog contract

**Files:**
- Create: `packages/catalog/src/source.ts`
- Create: `packages/catalog/src/source.test.ts`
- Modify: `packages/catalog/src/index.ts`
- Modify: `packages/catalog/src/client-types.ts`

**Interfaces:**
- Produces: `CatalogSource`, `SourceTerm`, `ScrapedCourse`, `CatalogProvenance`, and `flattenScrapedCourses`.
- `CatalogSource.kind`: `'fixture' | 'legacy-soc' | 'tss'`.
- `CatalogData.provenance`: `{ sourceKind: CatalogSource['kind']; mode: 'demo' | 'live'; sourceGeneratedAt: string }`.

- [ ] Write compile/runtime tests for accepted source kinds, course-to-section row ordering, and rejection of fixture provenance with `mode: 'live'`.
- [ ] Add Zod-validated provenance and the exact `CatalogSource` interface from the approved spec.
- [ ] Export source types from `packages/catalog/src/index.ts`.
- [ ] Update snapshot fixtures/tests to require provenance.
- [ ] Run `npx vitest run packages/catalog/src/source.test.ts packages/catalog/src/snapshot.test.ts`.
- [ ] Commit: `catalog: add source contract`

### Task 2: Sanitized FA26 fixture source

**Files:**
- Create: `packages/catalog/fixtures/fa26-demo.json`
- Create: `packages/catalog/src/fixture-source.ts`
- Create: `packages/catalog/src/fixture-source.test.ts`
- Modify: `scripts/seed-dev.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `FixtureCatalogSource implements CatalogSource`.
- Produces: `npm run seed:demo` importing through normalization/repository/snapshot boundaries.

- [ ] Define fixture records covering LE/DI/LA, TBA, finals, cancelled, open/full/unlimited, waitlist, variable units, and meeting/exam conflict pairs. Use invented instructors and section numbers; include no copied descriptions or student data.
- [ ] Write tests asserting every required edge-case marker exists and source rejects unknown terms/departments.
- [ ] Implement fixture source parsing with Zod bounds for term, departments, courses, sections, meetings, and exams.
- [ ] Replace direct HTML fixture reads in `seed-dev.ts` with `FixtureCatalogSource`; write `demo` provenance into the snapshot.
- [ ] Run `npm run seed:demo` against disposable PostgreSQL, then query `CatalogSnapshot` and verify `termId=FA26`, `demo=true`, and all edge cases.
- [ ] Commit: `catalog: add FA26 demo source`

### Task 3: Source factory and disabled TSS boundary

**Files:**
- Create: `apps/worker/src/sources/fixture.ts`
- Create: `apps/worker/src/sources/legacy-soc.ts`
- Create: `apps/worker/src/sources/tss.ts`
- Create: `apps/worker/src/sources/factory.ts`
- Create: `apps/worker/src/sources/factory.test.ts`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `createCatalogSource(workerEnv): CatalogSource`.
- Production requires explicit `CATALOG_SOURCE=fixture`; TSS selection always throws `TSS source disabled`.

- [ ] Write tests proving fixture mode makes no network/bootstrap call, legacy mode rejects FA26 and later terms, and TSS cannot start even when credential-like environment keys are supplied.
- [ ] Add source configuration without any password/cookie/token fields.
- [ ] Wrap existing `SocFetcher`/crawl behind `LegacySocSource` and a pre-FA26 allowlist.
- [ ] Implement `TssSource` as a disabled boundary whose methods throw the stable disabled error.
- [ ] Run `npx vitest run packages/config/src/env.test.ts apps/worker/src/sources/factory.test.ts`.
- [ ] Commit: `worker: add catalog source factory`

### Task 4: Complete-department reconciliation

**Files:**
- Modify: `packages/catalog/src/repo.ts`
- Modify: `packages/catalog/src/repo.test.ts`
- Modify: `apps/worker/src/full-sync.ts`
- Modify: `apps/worker/src/full-sync.test.ts`

**Interfaces:**
- Changes: `upsertDepartment(termId, department, courses): Promise<UpsertDepartmentResult>`.
- A completed department scrape cancels all active sections for missing courses in that term/department.

- [ ] Add DB test: seed two CSE courses, sync only one, assert absent course sections become cancelled; assert another department is untouched; assert empty completed CSE result cancels CSE only.
- [ ] Run focused repo test and observe failure.
- [ ] Add explicit department argument and validate every input course belongs to it and term.
- [ ] Cancel unseen sections through `Course.subject` within the transaction.
- [ ] Update all call sites and worker tests.
- [ ] Run `npx vitest run packages/catalog/src/repo.test.ts apps/worker/src/full-sync.test.ts`.
- [ ] Commit: `catalog: reconcile removed courses`

### Task 5: Truthful failure and bounded snapshots

**Files:**
- Modify: `apps/worker/src/full-sync.ts`
- Modify: `apps/worker/src/full-sync.test.ts`
- Modify: `packages/catalog/src/snapshot.ts`
- Modify: `packages/catalog/src/snapshot.test.ts`
- Modify: `packages/config/src/env.ts`

**Interfaces:**
- `fullSync` rejects after recording a top-level failure.
- `buildSnapshot(termId, options?)` rejects before persistence above configured course/section/serialized-byte bounds.

- [ ] Add tests proving department-list failure records `error`, sets `finishedAt`, and rejects; snapshot remains last-good.
- [ ] Add tests for maximum course count, section count, and serialized bytes; ensure rejected builds do not increment version.
- [ ] Implement a sanitized error summary and rethrow after best-effort ImportRun completion.
- [ ] Count database rows before materialization; measure final JSON bytes before upsert; expose conservative defaults through validated worker env.
- [ ] Run focused worker/catalog suites.
- [ ] Commit: `worker: fail loudly and bound snapshots`

### Task 6: Production worker lifecycle

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/index.test.ts`
- Modify: `apps/worker/package.json`
- Modify: `apps/worker/tsconfig.json`
- Create: `apps/worker/tsconfig.build.json`

**Interfaces:**
- Produces: `startWorker(deps): Promise<{ stop(): Promise<void> }>`.
- Production scripts: `build` and `start`; `tsx` remains development-only.

- [ ] Add fake-timer tests proving `stop()` clears both intervals, prevents new work, waits for active ticks, closes fetcher/resources, and disconnects Prisma exactly once.
- [ ] Refactor `main` into injectable `startWorker`; register idempotent SIGTERM/SIGINT handlers only in entrypoint.
- [ ] Compile to `dist`; ensure package-relative ESM imports resolve under Node without `tsx`.
- [ ] Run `npm run build --workspace @webreg/worker` and a bounded start smoke test with fixture source.
- [ ] Commit: `worker: add production lifecycle`

## Unresolved Questions

- None. Authorized TSS adapter deferred.
