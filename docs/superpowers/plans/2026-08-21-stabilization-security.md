# Stabilization and Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the in-progress hardening, restore deterministic green checks, and make API/auth health semantics trustworthy.

**Architecture:** Keep security controls at existing boundaries: validated config in `@webreg/config`, reusable request guards in `apps/web/lib`, and thin route handlers. Complete dirty-tree work before broader feature changes.

**Tech Stack:** TypeScript, Next.js 16, Auth.js 5 beta, Zod, Redis, Prisma, Vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-21-production-ready-planner-design.md`

## Global Constraints

- Preserve all user-owned uncommitted changes.
- Tests first; observe intended failure before implementation.
- Production configuration fails closed.
- No UCSD credentials, cookies, tokens, or student records.
- Commit messages concise; no AI attribution.

---

### Task 1: Deterministic test and build baseline

**Files:**
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Test: `apps/web/lib/guest-storage.test.ts`
- Test: `apps/web/lib/store.test.ts`

**Interfaces:**
- Produces: deterministic jsdom storage by disabling Node's conflicting experimental webstorage in Vitest workers.
- Produces: `typecheck:clean` running `tsc -b --clean && tsc -b --force --pretty false`.

- [ ] Add `execArgv: ['--no-experimental-webstorage']` to Vitest worker configuration; retain `fileParallelism: false` for shared-DB suites.
- [ ] Run `npx vitest run apps/web/lib/guest-storage.test.ts apps/web/lib/store.test.ts`; expect 26 passing tests.
- [ ] Add root scripts: `typecheck:clean`, `lint`, `build:web`, `build:worker`, and `verify` without shell deletion outside repository TypeScript metadata.
- [ ] Run `npm run typecheck:clean`; verify missing exports fail instead of being hidden by stale `.tsbuildinfo`.
- [ ] Commit: `test: stabilize web environment`

### Task 2: Validated web environment

**Files:**
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `loadWebEnv(source?, nodeEnv?): WebEnv`.
- `WebEnv`: optional development values; production requires HTTPS `APP_ORIGIN`, 32 UTF-8-byte non-placeholder secret, Google credentials, `rediss:` Redis, positive proxy hops.

- [ ] Run `npx vitest run packages/config/src/env.test.ts`; observe the three `loadWebEnv is not a function` failures.
- [ ] Implement a separate `WebEnvSchema` and exact-origin refinement. Measure secrets with `Buffer.byteLength(value, 'utf8')`; reject the placeholder strings enumerated in the existing tests.
- [ ] Keep `loadEnv` worker requirements unchanged. Never let `source.NODE_ENV` override the explicit `nodeEnv` argument.
- [ ] Add `APP_ORIGIN`, `REDIS_URL`, `TRUSTED_PROXY_HOPS`, `ENABLE_HSTS`, and nonfunctional project-role contact examples to `.env.example`; remove personal email values.
- [ ] Run `npx vitest run packages/config/src/env.test.ts`; expect all 24 tests passing.
- [ ] Commit: `config: validate production web env`

### Task 3: Auth and mutation-origin enforcement

**Files:**
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/lib/route-security.ts`
- Modify: `apps/web/lib/route-security.test.ts`
- Modify: `apps/web/app/api/schedules/route.ts`
- Modify: `apps/web/app/api/schedules/[id]/route.ts`
- Modify: `apps/web/app/api/schedules/[id]/copy/route.ts`
- Modify: `apps/web/app/api/schedules/[id]/items/route.ts`
- Test: `apps/web/tests/api-schedules.test.ts`

**Interfaces:**
- Produces: `enforceMutationOrigin(request, { appOrigin?, production? }): Response | null`.
- Produces: Auth.js provider configuration sourced only from `loadWebEnv()`.

- [ ] Add route-security tests proving exact origin acceptance, mismatch/missing-origin production rejection, and development allowance.
- [ ] Run `npx vitest run apps/web/lib/route-security.test.ts`; confirm new tests fail.
- [ ] Implement `enforceMutationOrigin`; return generic `403` JSON and compare parsed origins, not prefix strings.
- [ ] Compose origin enforcement after authentication and before mutations in POST/PATCH/PUT/DELETE routes.
- [ ] Make Auth.js consume `loadWebEnv`; upsert only profiles with a verified nonempty email.
- [ ] Extend API tests for rejected cross-origin mutation and unchanged successful response shapes.
- [ ] Run `npx vitest run apps/web/lib/route-security.test.ts apps/web/tests/api-schedules.test.ts` with disposable PostgreSQL.
- [ ] Commit: `security: enforce mutation origin`

### Task 4: Public API correctness

**Files:**
- Modify: `apps/web/app/api/health/route.ts`
- Modify: `apps/web/app/api/seats/[termId]/route.ts`
- Modify: `apps/web/app/api/schedules/[id]/route.ts`
- Modify: `apps/web/lib/bounded-json.ts`
- Test: `apps/web/tests/api-public.test.ts`
- Test: `apps/web/tests/api-schedules.test.ts`

**Interfaces:**
- Health response remains coarse: `{ ok: boolean }`; no term IDs or timestamps.
- Seat lookup requires section course term to equal path `termId`.

- [ ] Write tests: fatal `ImportRun.error` makes health false; stale/unfinished full sync makes health false; cross-term seat IDs are omitted; oversized rename body returns the existing stable `400 { error: 'invalid body' }` response.
- [ ] Run focused tests and observe failures.
- [ ] Query latest full runs, require `finishedAt`, `error === null`, zero failed departments, and configured freshness; return only aggregate `{ ok }`.
- [ ] Join seat query through `course.termId` and validate bounded `termId`/section IDs.
- [ ] Replace direct `req.json()` in rename with `readBoundedJson` using the existing mutation byte limit.
- [ ] Run `npx vitest run apps/web/tests/api-public.test.ts apps/web/tests/api-schedules.test.ts`.
- [ ] Commit: `api: harden health and seats`

### Task 5: Stabilization gate

**Files:**
- Modify: `docs/security/production-security-review.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] Add lifecycle coverage, then fix `useFocusTrap` lint by updating the callback ref inside `useEffect`.
- [ ] Remove the unused seats route context warning.
- [ ] Run `npm test` with PostgreSQL and Redis configured; expect zero failures and zero unexpected skips.
- [ ] Run `npm run typecheck:clean`, `npm run lint`, and `npm run build:web`.
- [ ] Update security review/progress with verified commands and remaining external controls only.
- [ ] Commit: `chore: close security baseline`

## Unresolved Questions

- None. Live TSS access is outside this plan.
