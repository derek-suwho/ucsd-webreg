# Production Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement every applicable finding in the production security review without changing the repository's architecture or successful API behavior.

**Architecture:** Enforce data integrity in Prisma, HTTP controls in focused Next.js helpers and proxy code, distributed limits in Redis, and worker resource/serialization controls at upstream and job boundaries. Production configuration fails closed; tests inject deterministic local dependencies.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma/PostgreSQL, Redis, Auth.js, Vitest, Zod, Pino.

## Global Constraints

- Work in review severity order: High, Medium, Low, Informational.
- Preserve successful response shapes, ownership checks, JWT sessions, and current component UX.
- Use `REDIS_URL` with a TLS-capable standard Redis deployment.
- Keep files below 500 lines and validate input at every system boundary.
- Preserve existing uncommitted work.
- Do not create commits unless the user explicitly requests them.

---

### Task 1: SEC-03 development database isolation

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `POSTGRES_PASSWORD` supplied by the local operator.
- Produces: loopback-only local PostgreSQL and no committed static password.

- [ ] Change Compose to require `${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}` and publish `127.0.0.1:5432:5432`.
- [ ] Replace the concrete `DATABASE_URL` password in `.env.example` with a nonfunctional generated-secret placeholder and add concise production private-network/TLS/role guidance.
- [ ] Run `POSTGRES_PASSWORD=test-password docker compose config`; expect a valid rendered configuration whose host binding is `127.0.0.1`.
- [ ] Run `rg "webreg:webreg|5432:5432" docker-compose.yml .env.example`; expect no insecure credential or all-interface binding.

### Task 2: SEC-01 schedule integrity and global quotas

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260721230000_secure_schedule_relations/migration.sql`
- Modify: `apps/web/app/api/schedules/route.ts`
- Modify: `apps/web/app/api/schedules/[id]/copy/route.ts`
- Modify: `apps/web/app/api/schedules/[id]/items/route.ts`
- Modify: `apps/web/tests/api-schedules.test.ts`
- Create: `apps/web/lib/bounded-json.ts`
- Create: `apps/web/lib/bounded-json.test.ts`

**Interfaces:**
- Produces: `readBoundedJson(request: Request, maxBytes: number): Promise<unknown>` and shared constants `MAX_SCHEDULES_PER_USER = 20`, `MAX_SCHEDULE_ITEMS = 40`, `MAX_IDENTIFIER_LENGTH = 128`.

- [ ] Add failing bounded-body tests for missing/invalid content length, streamed payloads over 16 KiB, valid JSON, and malformed JSON.
- [ ] Run `npx vitest run apps/web/lib/bounded-json.test.ts`; expect failures because the helper does not exist.
- [ ] Implement a byte-counting stream reader that cancels over-limit bodies and parses UTF-8 JSON without logging body contents.
- [ ] Add failing database integration tests for invented/inactive terms, 20 schedules spread across terms, a concurrent 21st create, nonexistent sections, cross-term sections, and 129-character IDs.
- [ ] Seed valid `Term`, `Course`, and `Section` rows in schedule test setup so existing success tests use real foreign keys.
- [ ] Run `DATABASE_URL=postgresql://webreg:test-password@127.0.0.1:5432/webreg npx vitest run apps/web/tests/api-schedules.test.ts`; expect the new security assertions to fail.
- [ ] Add Prisma relations and indexes. Use `onDelete: Restrict` for schedule terms and `onDelete: Cascade` for section items. Add back-relations on `Term` and `Section`.
- [ ] Generate a migration that deletes only orphaned schedule items/schedules, then adds both foreign keys and indexes.
- [ ] Update create to parse at most 16 KiB, require an active term in the serializable transaction, and count `{ userId }` globally.
- [ ] Update copy to count `{ userId }` globally in its serializable transaction.
- [ ] Update item replacement to deduplicate IDs, query sections with their course term, reject unless every requested section belongs to the schedule term, and perform validation/delete/create in one transaction.
- [ ] Run Prisma generation, the schedule integration test, and the full suite; expect all schedule tests to pass.

### Task 3: SEC-02 distributed web rate limiting

**Files:**
- Modify: `apps/web/package.json`
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Create: `apps/web/lib/client-ip.ts`
- Create: `apps/web/lib/client-ip.test.ts`
- Create: `apps/web/lib/rate-limit.ts`
- Create: `apps/web/lib/rate-limit.test.ts`
- Create: `apps/web/lib/route-security.ts`
- Modify: public, auth, and schedule route files under `apps/web/app/api/`

**Interfaces:**
- Produces: `getClientIp(request, trustedProxyHops)`, `checkRateLimit({ bucket, key, limit, windowSeconds })`, and `rateLimitResponse(retryAfterSeconds)`.

- [ ] Install the current supported `redis` package through npm.
- [ ] Add failing tests proving right-to-left trusted-proxy hop selection, rejection of malformed forwarding chains, and no trust when hop count is zero.
- [ ] Implement strict client-IP parsing for IPv4/IPv6 without accepting arbitrary leftmost forwarded values.
- [ ] Add failing limiter tests using an injected store for independent bucket keys, expiry, allowed counts, fail-closed store errors, and `429`/`Retry-After`.
- [ ] Implement one lazily connected Redis client per process, atomic `INCR` plus first-write expiry, and a deterministic test store interface.
- [ ] Add production config fields `REDIS_URL` and `TRUSTED_PROXY_HOPS`; require `rediss:` and a positive integer in production.
- [ ] Apply per-IP limits to terms, catalog, seats, health, and Auth.js routes, with tighter catalog/health/auth buckets.
- [ ] Apply per-user mutation limits after `requireUser()` to schedule POST/PATCH/PUT/DELETE/copy routes.
- [ ] Add route tests for allowed requests, `429`, `Retry-After`, and a generic `503` on production limiter failure.
- [ ] Run focused web tests and then the full suite.

### Task 4: SEC-09 bounded upstream crawling

**Files:**
- Modify: `apps/worker/src/fetcher.ts`
- Modify: `apps/worker/src/fetcher.test.ts`
- Modify: `apps/worker/src/crawl.ts`
- Create: `apps/worker/src/crawl.test.ts`

**Interfaces:**
- Produces constants for maximum HTML bytes, JSON bytes, departments, pages, rows, and page-worker concurrency.

- [ ] Add failing fetcher tests for wrong content type, 4xx responses, oversized streamed HTML/JSON, malformed department JSON, and excessive department count.
- [ ] Implement bounded stream reading, expected media-type checks, response-status checks, and Zod department validation.
- [ ] Add failing crawl tests for page counts below 1/above 100, cumulative rows above the cap, preserved page order, and no more than four page tasks executing concurrently.
- [ ] Replace `Promise.all(Array.from(...))` with a fixed-size worker loop and cumulative row checks.
- [ ] Run `npx vitest run apps/worker/src/fetcher.test.ts apps/worker/src/crawl.test.ts`; expect all tests to pass.

### Task 5: SEC-10 cross-replica catalog-write serialization

**Files:**
- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/catalog-lock.ts`
- Create: `apps/worker/src/catalog-lock.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/cli.ts`

**Interfaces:**
- Produces: `withCatalogLock<T>(termId: string, operation: () => Promise<T>, deps?): Promise<{ acquired: boolean; value?: T }>`.

- [ ] Install `pg` and `@types/pg` through npm.
- [ ] Add failing tests for parameterized acquisition, skipped operations when unavailable, unlock/close after success, and unlock/close after thrown errors.
- [ ] Implement a dedicated `pg.Client` session using `DATABASE_URL`, `pg_try_advisory_lock(hashtext($1), hashtext($2))`, and `pg_advisory_unlock` in `finally`.
- [ ] Wrap full sync and seat refresh per term with the same `catalog-write` lock key in scheduler and CLI paths.
- [ ] Ensure skipped locks log only term ID and job kind.
- [ ] Run lock, full-sync, seat-refresh, and CLI tests.

### Task 6: SEC-04 dependency remediation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: supported fixed Vitest/Vite versions and PostCSS 8.5.10 or newer.

- [ ] Run `npm install --save-dev vitest@latest` and add a root PostCSS override only if Next's resolved tree remains below 8.5.10.
- [ ] Run `npm ls vitest vite postcss`; verify no vulnerable versions remain.
- [ ] Run `npm audit` and `npm audit --omit=dev`; record any remaining advisory that cannot be safely upgraded without a breaking framework change.
- [ ] Run the full test suite, typecheck, lint, and build after lockfile regeneration.

### Task 7: SEC-05 nonce CSP and browser headers

**Files:**
- Modify: `apps/web/next.config.ts`
- Create: `apps/web/lib/security-headers.ts`
- Create: `apps/web/lib/security-headers.test.ts`
- Create: `apps/web/proxy.ts`

**Interfaces:**
- Produces: `buildContentSecurityPolicy(nonce, production)` and `proxy(request: NextRequest)`.

- [ ] Add failing tests for nonce inclusion, production denial of eval/inline script, frame denial, MIME/referrer/permissions policies, and production-only HSTS.
- [ ] Implement deterministic header construction with development-only `'unsafe-eval'`.
- [ ] Add a proxy that uses `crypto.randomUUID()` encoded as base64, passes CSP to rendering, and returns all security headers.
- [ ] Set `poweredByHeader: false` and a matcher that excludes static/image/favicon assets.
- [ ] Run security-header tests and the Next production build.

### Task 8: SEC-06 production auth and origin validation

**Files:**
- Modify: `packages/config/src/env.ts`
- Modify: `packages/config/src/env.test.ts`
- Modify: `apps/web/lib/auth.ts`
- Create: `apps/web/lib/origin.ts`
- Create: `apps/web/lib/origin.test.ts`
- Modify: schedule mutation routes

**Interfaces:**
- Produces: `loadWebEnv(source, nodeEnv)` and `validateMutationOrigin(request, appOrigin)`.

- [ ] Add failing tests requiring HTTPS `APP_ORIGIN`, 32-byte minimum decoded/UTF-8 Auth.js secret, Google credentials, TLS Redis, and proxy hops only in production.
- [ ] Add failing exact-origin tests for missing, malformed, sibling-subdomain, path-bearing, and matching origins.
- [ ] Implement web-specific environment parsing and exact-origin comparison.
- [ ] Configure Auth.js from validated values while retaining Google provider, JWT sessions, and callbacks.
- [ ] Enforce origin validation on schedule mutations in production without affecting same-origin development/tests.
- [ ] Run config, origin, auth-route, and schedule tests.

### Task 9: SEC-07 coarse public health

**Files:**
- Modify: `apps/web/app/api/health/route.ts`
- Modify: `apps/web/tests/api-public.test.ts`

**Interfaces:**
- Produces: public `{ ok: boolean }` with shared cache headers.

- [ ] Change health tests first to require no term/timestamp fields and `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
- [ ] Run the public API test and confirm it fails against the detailed response.
- [ ] Replace per-term queries with one latest-active-term health evaluation and return only the aggregate boolean.
- [ ] Run public API and rate-limit tests.

### Task 10: SEC-11 archived secret and repository scanning

**Files:**
- Modify: `archive/reference/uxdy-scheduleofclasses-scrape.ts`
- Create: `.github/workflows/security.yml`

**Interfaces:**
- Produces: nonfunctional archived cookie and read-only CI security checks.

- [ ] Replace the complete cookie with `REDACTED_ARCHIVED_SESSION_COOKIE`.
- [ ] Add a least-privilege workflow with read-only permissions, pinned checkout, secret scanning, dependency review, tests, and typecheck.
- [ ] Run a repository secret scan locally if the scanner is available; otherwise validate the workflow syntax and report the deployment-side check.
- [ ] Confirm the original cookie value no longer appears in the working tree.

### Task 11: SEC-12 production worker artifact

**Files:**
- Modify: `apps/worker/package.json`
- Create: `apps/worker/Dockerfile`
- Create: `.dockerignore`

**Interfaces:**
- Produces: `npm run build -w @webreg/worker`, `npm start -w @webreg/worker`, and a non-root production image.

- [ ] Add an esbuild-based bundle for `src/index.ts` and `src/cli.ts`, externalizing runtime third-party packages while bundling workspace source.
- [ ] Keep `tsx` scripts under development names and add `start: node dist/index.js`.
- [ ] Build a multi-stage Node 20 image, install production dependencies in the runtime stage, copy generated Prisma client and worker bundles, and run as the built-in non-root node user.
- [ ] Run the worker build and `node --check apps/worker/dist/index.js`.
- [ ] Build the container and inspect its configured user when Docker is available.

### Task 12: SEC-08 contact address and deployment documentation

**Files:**
- Modify: `.env.example`
- Modify: `docs/security/production-security-review.md`

**Interfaces:**
- Produces: project-role contact placeholder and checked implementation/deployment status.

- [ ] Replace the personal Gmail address with `ops@example.org` and state that deployments must use a monitored project-owned mailbox.
- [ ] Add every new variable: `POSTGRES_PASSWORD`, `APP_ORIGIN`, `NEXTAUTH_SECRET`, Google credentials, `REDIS_URL`, and `TRUSTED_PROXY_HOPS`.
- [ ] Update the review status/checklist with implemented controls, intentionally manual infrastructure controls, migration order, CSP rollout, OAuth console steps, secret rotation, backups, and history-cleanup guidance.
- [ ] Re-scan tracked templates and logs for personal addresses and secrets.

### Task 13: Final verification

**Files:**
- Review all modified files and generated migration/lockfile.

- [ ] Start the loopback-only test PostgreSQL using the required password.
- [ ] Run Prisma generate and apply migrations to a clean database.
- [ ] Run `npm test`; require zero failures.
- [ ] Run `npm run typecheck`; require exit code 0.
- [ ] Run `npm run lint -w @webreg/web`; require exit code 0.
- [ ] Run `npm run build -w @webreg/web`; require exit code 0 with production env values.
- [ ] Run `npm run build -w @webreg/worker` and `node --check apps/worker/dist/index.js`; require exit code 0.
- [ ] Run `npm audit` and `npm audit --omit=dev`; report exact remaining advisories.
- [ ] Run IDE diagnostics on every edited TypeScript file and resolve introduced errors.
- [ ] Re-read `docs/security/production-security-review.md` line by line and map each finding to code, tests, manual deployment action, or explicit justification.
