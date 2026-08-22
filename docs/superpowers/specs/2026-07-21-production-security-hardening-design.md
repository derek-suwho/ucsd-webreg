# Production Security Hardening Design

## Goal

Address every applicable finding in `docs/security/production-security-review.md` with minimal, targeted changes while preserving the Next.js App Router, TypeScript, Prisma, shared-package, component, and background-worker architecture.

## Constraints

- Preserve successful API response shapes and existing UX.
- Avoid breaking API changes unless required to reject insecure input.
- Keep security logic strongly typed and reusable.
- Validate all input at HTTP and upstream-network boundaries.
- Use Redis over `REDIS_URL` as the shared production rate-limit store.
- Preserve user-owned uncommitted work and do not commit changes unless requested.

## Architecture

Security controls remain close to their trust boundaries:

- Prisma enforces schedule-to-term and schedule-item-to-section integrity.
- Small web helpers enforce bounded JSON bodies, exact-origin checks, trusted-proxy client identification, and distributed rate limits.
- A Next.js proxy creates a per-request nonce and applies Content Security Policy headers.
- Production-specific environment parsing fails closed when authentication, Redis, origin, or proxy configuration is invalid.
- Worker fetch and crawl helpers bound untrusted upstream data before allocating memory or parsing it.
- A dedicated PostgreSQL connection holds an advisory lock while either catalog-writing job runs for a term, serializing full sync and seat refresh across job types and replicas.

## Finding Designs

### SEC-03 — Database exposure

`docker-compose.yml` will be explicitly development-only. PostgreSQL will bind to `127.0.0.1`, and Compose will require an externally supplied password rather than embedding `webreg:webreg`. The environment template will use nonfunctional placeholders and explain that production requires private networking, TLS, generated secrets, and separate migration/runtime roles.

### SEC-01 — Schedule quota and referential integrity

Prisma will add `Schedule.termId -> Term.id` and `ScheduleItem.sectionId -> Section.id` relations with supporting back-relations and indexes. The migration will remove only rows that cannot satisfy the new integrity constraints before adding foreign keys.

Schedule creation will:

- accept bounded identifiers and names in a bounded request body;
- require an active existing term;
- count all schedules for the user, regardless of term;
- retain serializable transaction retries and the existing `422` quota response.

Schedule copy will use the same global quota. Item replacement will verify in one transaction that every distinct section exists and belongs to the schedule term before replacing items. Invalid terms, sections, cross-term sections, oversized bodies, and overlong identifiers return `400`.

The global limit remains 20 schedules per user, and each schedule remains limited to 40 distinct sections.

### SEC-02 — Distributed rate limiting

The web app will use a shared Redis client configured by `REDIS_URL`. A reusable limiter will provide fixed-window counters, explicit limits, `Retry-After`, and `429` responses.

Limits will be keyed by:

- validated client IP for anonymous public and Auth.js routes;
- authenticated user ID for schedule mutations;
- endpoint class so expensive catalog and health requests have tighter bursts than small public reads.

Client IP extraction will trust `X-Forwarded-For` only when the production deployment declares an exact positive trusted-proxy hop count. Production cannot silently fall back to spoofable forwarding headers or process-local counters. Tests use an injected in-memory store; development may use a clearly logged process-local fallback when Redis is absent.

If mandatory production rate-limit infrastructure is unavailable, protected routes fail closed with a generic `503`.

### SEC-05 — Browser security headers

A Next.js proxy will generate a cryptographically random nonce per request, set a nonce-based CSP request header for Next.js rendering, and return the corresponding response policy. Production policy will include `default-src 'self'`, nonce-restricted scripts, `frame-ancestors 'none'`, restrictive object/base/form/connect/image/font/style directives, and no development-only evaluation allowance.

Global headers will also set:

- `X-Content-Type-Options: nosniff`;
- strict referrer policy;
- restrictive permissions policy;
- HSTS in production only;
- compatibility frame denial in addition to CSP.

Next.js will disable `X-Powered-By`. The CSP will be testable independently and may be deployed report-only before enforcement at the hosting edge.

### SEC-06 — Authentication configuration

The shared config package will expose a web-specific production parser. Production requires:

- `APP_ORIGIN` as an HTTPS origin without a path;
- `NEXTAUTH_SECRET` containing at least 32 bytes of entropy;
- nonempty Google client ID and client secret;
- `REDIS_URL` using a TLS-capable Redis URL;
- an exact trusted-proxy hop count.

Auth.js will consume validated values rather than reading optional `process.env` values directly. Schedule mutations will reject requests whose `Origin` does not exactly match `APP_ORIGIN` in production. Auth.js retains JWT sessions and its built-in OAuth state/CSRF handling.

### SEC-07 — Public health telemetry

The public health endpoint will return only a coarse `{ ok: boolean }` status with shared-cache directives and no term IDs or synchronization timestamps. Detailed job telemetry remains in structured worker logs until an authenticated operator endpoint is explicitly designed.

### SEC-09 — Worker resource bounds

The fetcher will:

- reject non-success responses;
- require expected HTML or JSON content types;
- stream response bodies with endpoint-specific byte limits;
- validate department-list shape and count before returning it.

The crawler will reject unsafe page counts before allocation, fetch remaining pages through a fixed-size worker pool, and stop when the cumulative parsed-row limit is exceeded. Existing full-sync behavior already quarantines a failed department in `ImportRun`; bound violations will use that same path.

### SEC-10 — Shared catalog-write lock

A lock helper backed by a dedicated `pg` connection will acquire a parameterized PostgreSQL advisory lock keyed by term and the common `catalog-write` resource. Full sync and seat refresh will both execute through this helper. Failure to acquire logs a skip rather than queueing duplicate work, and `finally` always unlocks and closes the dedicated connection. Existing upsert/snapshot behavior remains the idempotency foundation.

### SEC-04 — Vulnerable dependencies

Vitest and its Vite tree will be upgraded to fixed supported releases. If the installed compatible Next.js version still pins vulnerable PostCSS, the root package will use a tested override at PostCSS 8.5.10 or newer. The complete test suite, typecheck, lint, and production build must pass after lockfile regeneration. Audit guidance will explicitly reject the unsafe Next.js downgrade suggested by npm.

### SEC-11 — Archived cookie

The concrete archived cookie will be replaced with a nonfunctional placeholder. Repository automation will scan for secrets and dependencies. Git-history cleanup and upstream cookie invalidation remain manual because rewriting shared history and invalidating an external session cannot be safely automated from source changes.

### SEC-12 — Worker production boundary

The worker will compile to `dist`, start with `node dist/index.js`, and keep `tsx` only for development. A multi-stage production image will install/build workspace dependencies, copy compiled runtime artifacts, install only production dependencies in the final stage, and run as a non-root user.

### SEC-08 — Contact address

The personal address will be removed from `.env.example` and replaced with a project-owned role-address placeholder. Runtime email validation remains in place.

## Error Handling and Logging

Expected client failures return stable, generic JSON errors without stack traces or infrastructure details. Rate limits return `429` and `Retry-After`; mandatory security-service outages return `503`.

Worker logs contain operation names, term IDs, counts, and sanitized error summaries. Cookies, authorization material, connection strings, OAuth credentials, Redis credentials, response bodies, and full request URLs are never logged.

## Testing

Tests will be added before each behavior change and observed failing for the intended reason.

Database integration tests cover:

- invented and inactive term rejection;
- global quota across multiple terms;
- concurrent quota attempts;
- nonexistent and cross-term section rejection;
- identifier and request-body bounds;
- preservation of ownership and successful response behavior.

Unit tests cover:

- Redis counter keying, expiry, `429`, and `Retry-After`;
- trusted-proxy IP extraction and exact-origin checks;
- development and production environment validation;
- CSP nonce and security header generation;
- upstream content-type, byte, department, page, and row bounds;
- bounded crawl concurrency;
- advisory-lock acquisition, skip, release, and failure cleanup.

Final verification runs the PostgreSQL-backed full suite, `npm run typecheck`, web lint, Next.js production build, worker build/start smoke test, and dependency audit.

## Deployment

Before public launch:

1. Generate high-entropy database and Auth.js secrets in the deployment secret manager.
2. Provision private TLS PostgreSQL and TLS Redis, with network allowlists.
3. Create separate least-privileged migration and runtime database roles.
4. Set the exact HTTPS application origin, OAuth origin/callback URI, and trusted-proxy hop count.
5. Run the Prisma migration with the migration role before deploying application instances.
6. Deploy CSP in report-only mode, review violations, then enforce it.
7. Build and run the worker image as its non-root user.
8. Configure encrypted backups, restoration tests, log retention, and alerts outside the repository.

## Intentionally Manual Controls

The repository cannot itself configure cloud firewalls, managed TLS, secret rotation, OAuth console allowlists, database backups, log retention/access, or invalidate the archived upstream cookie. It will document these as mandatory deployment steps rather than claiming source code can enforce them.
