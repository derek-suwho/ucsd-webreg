# Production Security Review

**Repository:** `ucsd-webreg`
**Initial review date:** July 21, 2026
**Status updated:** August 22, 2026
**Initial production-readiness score:** 5.5/10 (not rescored)
**Status:** July findings are retained as the discovery baseline. Current repository controls are implemented; production launch remains blocked on external/cloud, legal, backup/operations, history-scan, and clean-lineage evidence.

## Executive Summary

The review found:

- 0 Critical findings
- 1 High finding
- 4 Medium findings
- 6 Low findings
- 1 Informational finding

No direct SQL injection, SSRF, stored XSS, cross-user authorization bypass, path traversal, file-upload vulnerability, or open redirect was identified in production code.

The application has solid authorization and output-encoding foundations. The current tree addresses the repository defects described below and now includes CI, production containers, Railway configuration, strict driver-supported PostgreSQL TLS validation, a zero-production-vulnerability npm audit, and a redacted archived cookie. None of this establishes deployed infrastructure, hosted-CI success, legal approval, backups, monitoring, or incident response.

## Stabilization Status

Current repository controls as of August 22:

- Schedule terms/items are relationally constrained; quotas, identifier/body bounds, cross-term rejection, and mutation-origin checks have regression coverage.
- Public/auth routes use per-IP limits; authenticated mutations use per-user limits. Production requires a TLS Redis URL and fails closed when the limiter is unavailable.
- Worker fetches bound content type, response bytes, department/page/row counts, concurrency, and retries. Term-scoped catalog writes use PostgreSQL advisory locks.
- Production database configuration requires exactly one Prisma-supported `sslmode=require` and `sslaccept=strict`; node-postgres receives `rejectUnauthorized: true`. Runtime/migration roles remain distinct.
- Web configuration validates exact HTTPS origin, matching `AUTH_URL`, OAuth values, a 32-byte Auth.js secret, TLS Redis, trusted proxy hops, and optional HSTS.
- Public health is coarse and fail-closed; seat lookups are term-scoped.
- Nonce-based CSP and frame, MIME, referrer, permissions, and optional HSTS headers are present; the framework signature header is disabled.
- Development PostgreSQL binds to loopback and requires an injected password; the environment template uses a nonfunctional role address.
- Pinned, least-privilege GitHub Actions define Node 22/24 database/Redis gates, Chromium E2E, CodeQL, pull-request dependency review, three-image builds, production audit, and redacted current-tree secret scanning. A hosted run is not evidenced here.
- Multi-stage web/worker/migration images run as non-root; worker starts compiled JavaScript and handles graceful signals. Railway defines separate web, worker, and one-shot migration services.
- `npm audit --omit=dev` reports zero production vulnerabilities in the current dependency tree. The current archived scraper contains only a nonfunctional cookie placeholder.

Remaining external controls before launch:

1. Provision private, TLS PostgreSQL with network allowlists, separate migration/runtime roles, encrypted backups, and a tested restore.
2. Provision managed TLS Redis; set and verify trusted proxy hops; load-test limits and `429` behavior through the real edge.
3. Inject and rotate production secrets; restrict Google OAuth origins/callbacks to exact production values.
4. Verify TLS termination and reconcile app/edge CSP and HSTS; add production monitoring, alerting, log redaction, retention, and access controls.
5. Run the committed CI on the clean release SHA; baseline CodeQL, enable dependency graph/merge protection, and retain sanitized image/security evidence.
6. Resolve UCSD name/content/data permissions and repository license; complete full-history secret scan/cleanup and clean release lineage.

Residual release risks are external or evidentiary: the cookie may remain in Git history, full-history scanning/cleanup and clean lineage are incomplete, no repository license/legal approval exists, and cloud/backup/operations controls are not provisioned or proven.

## Findings

Unless a finding says otherwise, vulnerability/exploitation/recommendation text preserves the July 21 discovery baseline. Current-status notes describe the August 22 worktree; external deployment and clean-lineage evidence remain outstanding.

### SEC-03 — PostgreSQL exposed with fixed weak credentials (historical)

**Severity:** High

**Files:**

- `docker-compose.yml:1-7`
- `.env.example:1`

**Vulnerability**

The only container configuration publishes PostgreSQL on host port 5432 and uses the static credentials `webreg:webreg`. Docker's short port syntax binds on all host interfaces by default.

**Current status (2026-08-22):** Remediated in the repository. Compose is explicitly development-only, binds PostgreSQL to loopback, and requires an injected password. Production configs use external PostgreSQL, separate runtime/migration roles, and strict driver-supported TLS. Actual cloud network/TLS/role controls remain unproven.

**Exploitation conditions**

If this Compose configuration runs on an internet-accessible or untrusted-network host, anyone who can reach port 5432 can authenticate directly and read, alter, or delete application data.

**Recommendation**

- Treat the current Compose file as development-only.
- Remove the database host port in production.
- Place PostgreSQL on a private network protected by firewall rules.
- Use a generated high-entropy password delivered through a secret manager.
- Require database TLS.
- Use separate least-privileged migration and runtime database roles.

For local development, bind only to loopback:

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"
```

### SEC-01 — Schedule quota bypass with invented term IDs (historical)

**Severity:** Medium

**Files:**

- `apps/web/app/api/schedules/route.ts:10-13,61-66`
- `packages/db/prisma/schema.prisma:125-133`
- `apps/web/app/api/schedules/[id]/items/route.ts:5,26-32`

**Vulnerability**

`POST /api/schedules` accepts any non-empty `termId`. The 20-schedule quota is calculated per user and supplied term ID, while `Schedule.termId` has no foreign key to `Term`. An authenticated user can therefore bypass the quota by supplying a different invented term ID on every request.

Each resulting schedule can also store up to 40 arbitrary section ID strings. Section IDs have no relation to `Section` and no explicit string-length limit.

**Current status (2026-08-22):** Remediated. Relational term/section constraints, global account quota, identifier/body/item bounds, cross-term validation, ownership checks, and transactional deletion are implemented and tested.

**Exploitation conditions**

Any Google-authenticated account can repeatedly submit unique term IDs and large fictitious section IDs, causing unbounded database, memory, and write-ahead-log growth.

**Recommendation**

- Require `termId` to reference an existing allowed term.
- Add a `Schedule.termId → Term.id` foreign key.
- Add a `ScheduleItem.sectionId → Section.id` foreign key.
- Enforce a global per-user schedule quota.
- Cap identifier lengths.
- Validate that submitted sections belong to the schedule's term.
- Reject oversized request bodies.
- Rate-limit schedule mutations.

```ts
const term = await tx.term.findUnique({ where: { id: termId } })
if (!term?.active) {
  return Response.json({ error: 'invalid term' }, { status: 400 })
}

const total = await tx.schedule.count({ where: { userId: user.id } })
if (total >= MAX_SCHEDULES_PER_USER) {
  throw new ScheduleLimitError()
}
```

### SEC-02 — No application-level rate limiting (historical)

**Severity:** Medium

**Files:**

- `apps/web/app/api/catalog/[termId]/route.ts:3-17`
- `apps/web/app/api/health/route.ts:4-23`
- `apps/web/app/api/seats/[termId]/route.ts:8-22`
- `apps/web/app/api/schedules/route.ts:23-80`
- `apps/web/app/api/auth/[...nextauth]/route.ts:1-3`

**Vulnerability**

The repository contains no rate-limiting middleware or route-level limiter. Public catalog responses can be large, the health route executes multiple database queries, and authenticated mutations reach the database on every request.

**Current status (2026-08-22):** Remediated in code. Public/auth routes use per-IP limits; authenticated mutations use per-user limits. Production uses shared TLS Redis and fails closed when unavailable. Real-edge load/`429` behavior remains external evidence.

**Exploitation conditions**

Anonymous clients can repeatedly request public endpoints to consume bandwidth, database connections, and serverless spend. An authenticated attacker can flood mutations and amplify SEC-01.

**Recommendation**

- Apply per-IP limits to public and authentication routes.
- Apply per-user limits to authenticated mutations.
- Use tighter burst limits for expensive endpoints.
- Cache catalog, term, and coarse health responses at the edge.
- Return `429 Too Many Requests` with `Retry-After`.
- Use a shared limiter store for multi-instance deployments.

### SEC-09 — Upstream page counts and bodies can exhaust the worker (historical)

**Severity:** Medium

**Files:**

- `packages/catalog/src/parse.ts:154-167`
- `apps/worker/src/crawl.ts:13-20`
- `apps/worker/src/fetcher.ts:81-99`

**Vulnerability**

The scraper parses `pageCount` from remote HTML and passes it directly to `Array.from` and `Promise.all`. Response bodies are read without a byte limit. The existing four-request network limiter does not prevent creation of an arbitrarily large promise queue.

**Current status (2026-08-22):** Remediated. Content type/body, page/row, concurrency, retry, department, and whole-snapshot bounds are enforced; failures do not publish partial snapshots.

**Exploitation conditions**

A compromised, malformed, or unexpectedly changed `act.ucsd.edu` response can advertise a very large page count or return oversized bodies. This can exhaust worker memory and create prolonged upstream and database load.

**Recommendation**

- Reject page counts outside a defensible range.
- Enforce expected response content types.
- Limit response bytes and parsed rows.
- Fetch pages through a bounded worker pool.
- Abort and quarantine imports that violate limits.

```ts
const MAX_PAGES = 100

if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) {
  throw new Error('Invalid upstream page count')
}
```

### SEC-10 — Worker jobs lack a shared catalog-write lock (historical)

**Severity:** Medium

**Files:**

- `apps/worker/src/index.ts:40-55,64-74`

**Vulnerability**

The in-process `running` flag prevents repeated execution of the same timer only within one process. Full sync and seat refresh have separate guards, and multiple worker replicas do not coordinate.

**Current status (2026-08-22):** Remediated. Term-scoped PostgreSQL advisory locks coordinate writers across processes; in-process job guards prevent overlapping ticks, and worker shutdown is bounded.

**Exploitation conditions**

A slow job, aggressive interval, restart, or multiple replicas can concurrently mutate sections, seat snapshots, import runs, and catalog snapshots. This can create inconsistent output, database contention, duplicate upstream traffic, and availability loss.

**Recommendation**

- Use a PostgreSQL advisory lock or durable single-consumer queue.
- Key locks by term and catalog-writing job.
- Use leases or timeouts to recover abandoned locks.
- Make jobs idempotent.
- Ensure only one scheduler replica enqueues work.

### SEC-04 — Known-vulnerable dependencies (historical)

**Severity:** Low

**Files:**

- `apps/web/package.json:18-21`
- `package.json:10-14`
- `package-lock.json:7236-7239,9667-9675,9750-9757`

**Vulnerability**

The production Next.js dependency tree includes PostCSS 8.4.31, affected by `GHSA-qx2v-qp2m-jg93`. The development tree includes Vitest 2.1.9, affected by `GHSA-5xrq-8626-4rwp`, and Vite 5.4.21 with file-disclosure advisories.

**Current status (2026-08-22):** Remediated for the current dependency tree. Supported pins/overrides were reconciled through the lockfile; `npm audit --omit=dev` reports zero production vulnerabilities. CI reruns the production audit, while weekly Dependabot covers npm and GitHub Actions. Every dependency update still requires clean install, tests, types, lint, builds, and audit.

**Exploitation conditions**

The PostCSS advisory requires attacker-controlled CSS to be stringified and embedded in a style element. No such runtime path was found. The Vitest advisory requires an exposed Vitest UI server; the repository currently runs `vitest run`, so the vulnerable server is not part of normal CI execution.

**Recommendation**

- Upgrade Vitest to a fixed supported release and regenerate the lockfile.
- Never expose Vite or Vitest development servers to untrusted networks.
- Upgrade Next.js when a compatible release includes PostCSS 8.5.10 or newer.
- If using an override, test it with the build and complete test suite.
- Do not accept `npm audit`'s suggested downgrade to Next.js 9.3.3.

### SEC-05 — Browser security headers were not configured (historical)

**Severity:** Low

**Files:**

- `apps/web/next.config.ts:15-26`

**Historical finding (2026-07-21)**

The application does not define a Content Security Policy, frame restrictions, MIME-sniffing protection, referrer policy, permissions policy, or HSTS. It also does not disable the `X-Powered-By` header.

**Current status (2026-08-22)**

Implemented in `apps/web/lib/security-headers.ts`, `apps/web/proxy.ts`, and `apps/web/next.config.ts`, with regression coverage in `apps/web/lib/security-headers.test.ts`. HSTS remains conditional on `ENABLE_HSTS=true`; TLS-only delivery and edge-header reconciliation are external controls and are not verified here.

**Exploitation conditions**

No direct XSS sink was identified, making this defense-in-depth rather than an active injection vulnerability. Missing CSP would increase the impact of a future injection defect. Missing frame restrictions permit clickjacking unless equivalent controls are added by the hosting platform.

**Recommendation**

- Add a tested nonce-based CSP.
- Set `frame-ancestors 'none'`.
- Set `X-Content-Type-Options: nosniff`.
- Add strict referrer and permissions policies.
- Enable app HSTS with `ENABLE_HSTS=true` only when every production request is
  served exclusively through TLS. Reconcile it with edge-supplied HSTS headers;
  the app emits only `max-age=31536000` and does not claim subdomains or preload.
- Set `poweredByHeader: false`.
- Reconcile application headers with controls supplied by the hosting platform.

### SEC-06 — Production authentication secrets were not validated (historical)

**Severity:** Low

**Files:**

- `packages/config/src/env.ts:3-10`
- `apps/web/lib/auth.ts:5-10`
- `.env.example:3-7`

**Historical finding (2026-07-21)**

`NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` are optional in the shared environment schema. The web authentication module reads `process.env` directly instead of validating a production-specific schema.

**Current status (2026-08-22)**

Implemented: `loadWebEnv()` enforces strict PostgreSQL TLS, production origin, secret, OAuth, TLS Redis, and proxy-hop requirements. Auth.js derives its canonical URL from validated `APP_ORIGIN`, and an independently supplied `AUTH_URL` must match exactly. Production secret injection/rotation and exact provider-console configuration remain external.

**Exploitation conditions**

Auth.js should fail closed when required values are absent, making an authentication outage more likely than a bypass. Repository code does not reject weak, predictable, or accidentally reused secrets supplied by deployment automation.

**Recommendation**

- Require OAuth credentials in production.
- Require an Auth.js secret containing at least 32 random bytes.
- Parse and validate configuration at startup.
- Fail deployment health checks on invalid configuration.
- Store and rotate secrets through the hosting secret manager.

### SEC-07 — Public health route exposes synchronization timing (historical)

**Severity:** Low

**Files:**

- `apps/web/app/api/health/route.ts:3-23`

**Vulnerability**

`GET /api/health` returns each active term and the last full-sync and seat-refresh timestamps.

**Current status (2026-08-22):** Remediated. The public route is rate-limited and returns only coarse `{ ok }`; dependency readiness and catalog provenance/freshness are separate signals.

**Exploitation conditions**

Anyone can monitor operational cadence and outages. The information is not user-private, but it provides reconnaissance and makes the endpoint a query-amplification target.

**Recommendation**

Return only a cached coarse status publicly. Restrict detailed per-job timestamps to authenticated operators or internal monitoring.

### SEC-11 — Concrete upstream session cookie in archived source (historical; history unresolved)

**Severity:** Low

**Files:**

- `archive/reference/uxdy-scheduleofclasses-scrape.ts:17-18,76`

**Vulnerability**

An archived reference scraper contains a complete `jlink`, `itscookie`, and `TS` cookie header and sends it to UCSD. The file is not imported by the production build, but the value remains in source and Git history.

**Current status (2026-08-22):** The current tree uses `REDACTED_ARCHIVED_SESSION_COOKIE`, and regression/current-tree secret checks reject the known cookie names. Full-history scanning, invalidation where possible, cleanup decision, and clean public lineage remain unresolved.

**Exploitation conditions**

Anyone with repository access can replay the cookie while it remains valid. Available evidence indicates a public Schedule of Classes session rather than an authenticated student session, limiting demonstrated impact.

**Recommendation**

- Replace the cookie with a nonfunctional placeholder.
- Invalidate it if possible.
- Add automated secret scanning.
- Consider purging it from history before making the repository public.

### SEC-12 — Worker lacks a production runtime boundary (historical)

**Severity:** Low

**Files:**

- `apps/worker/package.json:5-7`

**Vulnerability**

Worker entry points execute TypeScript source through `tsx`, which is a development dependency. There is no compiled production start script or production container definition.

**Current status (2026-08-22):** Remediated. Worker builds bundled `dist` output, starts with `node apps/worker/dist/index.js`, installs production dependencies only in its runtime image, runs non-root, and handles SIGTERM/SIGINT cleanup. Actual image digest/deployment evidence remains external.

**Exploitation conditions**

`npm ci --omit=dev` leaves the worker unable to start. Keeping all development dependencies in production unnecessarily increases executable supply-chain and install-script exposure.

**Recommendation**

- Compile the worker to `dist`.
- Add a `node dist/index.js` production start command.
- Deploy only production dependencies and compiled output.
- Use a minimal immutable image and a non-root runtime user.

### SEC-08 — Personal contact address in environment template (historical)

**Severity:** Informational

**Files:**

- `.env.example:2`
- `apps/worker/src/fetcher.ts:87-90`

**Issue**

The committed environment template contains a personal Gmail address. The worker places `CONTACT_EMAIL` in every scraper User-Agent.

**Current status (2026-08-22):** Remediated in the current template with a nonpersonal project-role placeholder. Production must supply an owned and monitored role address.

**Recommendation**

Use a project-owned role address, such as `security@` or `ops@`, and remove personal addresses from committed templates.

## Security Controls Implemented Correctly

- Every schedule route calls `requireUser()`.
- Schedule reads are scoped to the authenticated user ID.
- Object-level authorization returns 404 for another user's schedule.
- Schedule creation and copy quotas use serializable transactions.
- Production database access uses Prisma's parameterized APIs and rejects URLs without exactly one `sslmode=require` and `sslaccept=strict`; node-postgres enables certificate rejection.
- Unsafe raw SQL appears only in tests and uses static statements.
- Zod validates schedule names, item counts, seat query cardinality, and worker CLI dates.
- React renders user and scraped strings through escaped JSX.
- No production `dangerouslySetInnerHTML`, `eval`, or dynamic script sink was found.
- Worker requests use a fixed HTTPS UCSD origin and encoded parameters.
- Worker requests have timeouts, retry backoff, request spacing, and bounded network concurrency.
- No file-upload, path-traversal, user-controlled redirect, command-execution, or permissive-CORS surface was found.
- `.env` is ignored and not tracked.
- No production OAuth credential or private key was found.
- Auth.js manages Google OAuth callbacks and JWT sessions.
- Ownership and unauthenticated behavior are covered by API integration tests.
- `package-lock.json` records exact versions and integrity hashes.
- The migration runner is production-only, role-separated, shell-free, bounded, and sanitizes errors.
- CI uses pinned actions, least privilege, Node 22/24, disposable PostgreSQL/Redis, E2E/axe, CodeQL, pull-request dependency review, three-image builds, production audit, and redacted current-tree secret scanning.
- Web, worker, and migration Dockerfiles are multi-stage and run as non-root; Railway service configs separate readiness, worker, and one-shot migration behavior.
- The current archived scraper contains a nonfunctional cookie placeholder; current production audit is zero.

## Remaining Hardening Checklist

- [ ] Use managed/private PostgreSQL with verified TLS, network allowlists, separate migration/runtime roles, encrypted backups, and tested restoration.
- [ ] Use managed TLS Redis; configure trusted proxy hops and verify rate limits/`429` responses through the production edge.
- [ ] Generate, store, and rotate production Auth.js/OAuth secrets; restrict Google OAuth origins and callback URIs exactly.
- [ ] Reconcile app security headers with the TLS edge; enable HSTS only after confirming HTTPS-only service.
- [ ] Define and verify production log redaction, retention, access control, monitoring, and alerts.
- [ ] Run hosted CI for the clean release SHA; baseline CodeQL findings, enable dependency graph/merge protection, and retain sanitized evidence.
- [ ] Build/scan exact candidate images, record immutable digests/SBOMs, and prove non-root/read-only runtime behavior.
- [ ] Scan complete Git history, decide/perform cleanup and rotation, and establish clean public lineage.
- [ ] Approve UCSD name/content/data use and repository license; keep live TSS disabled.
- [ ] Assign backup/RPO/RTO/retention owners and pass a restore drill and incident-response readiness review.

## Scope and Verification

Reviewed:

- Authentication and authorization
- API routes and inline Server Actions
- Middleware presence
- Prisma schema, migration, and database access
- SQL injection, XSS, CSRF, SSRF, redirects, path traversal, and file uploads
- Secrets and environment handling
- Sessions and Google OAuth
- Rate limiting, validation, output encoding, CORS, headers, and cookies
- Logging and error handling
- Production and development dependency trees
- Docker Compose
- Production Dockerfiles and Railway service configuration
- Worker and background-job behavior
- Available CI/CD and deployment configuration

Not present or not assessable from source alone:

- No file-upload feature
- No custom CORS policy
- No hosted CI result for a final clean release SHA
- No evidence for deployed TLS termination, firewall rules, cloud IAM, Railway variables, database/Redis provisioning, backups, restore drills, secret-manager configuration, monitoring, or log controls
- No complete Git-history scan/cleanup or clean-public-lineage evidence
- No legal approval for name/content/data use and no selected repository license

Verification performed on August 21, 2026:

- PostgreSQL migrations: 2 applied to a disposable loopback PostgreSQL 14 cluster.
- `DATABASE_URL=... npm test`: 30 files and 274 tests passed; 0 failures and 0 skipped. Rate-limit tests use deterministic injected stores/client factories, so this does not prove live managed Redis connectivity.
- `npm run typecheck:clean`: passed.
- `npx tsc -p apps/web/tsconfig.json --noEmit --pretty false`: passed.
- `npm run lint`: passed with 0 errors and 0 warnings.
- `npm run build:web` with non-secret validated production placeholders: passed; 11 application routes plus the proxy built.
- `npm run build:worker`: passed.

Current repository evidence recorded on August 22, 2026:

- `npm audit --omit=dev`: zero production vulnerabilities after supported dependency/lock remediation.
- Repository CI defines pinned Node 22/24 quality, Chromium E2E/axe, CodeQL, pull-request dependency review, three-image build, audit, and current-tree secret-scan jobs.
- Multi-stage non-root web, worker, and migration Dockerfiles plus separate Railway service configs are present.
- Production PostgreSQL validation uses Prisma-supported strict TLS parameters; current template and Railway runbook match.
- Archived current-tree cookie is redacted; history/lineage remains unchecked.
- This documentation reconciliation did not rerun tests, builds, hosted CI, container runtime smoke, or cloud controls. See [release checklist](../operations/release-checklist.md) for candidate evidence and unresolved gates.
