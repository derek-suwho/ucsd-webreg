# Release Engineering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reproducible CI, end-to-end/accessibility/visual verification, production containers, Railway configuration, and operational runbooks.

**Architecture:** CI provisions disposable PostgreSQL and Redis, builds immutable web/worker images, and runs every repository gate. Railway runs separate web, worker, and migration commands with managed TLS data services.

**Tech Stack:** GitHub Actions, Playwright, axe-core, Docker, Railway, PostgreSQL, Redis.

**Spec:** `docs/superpowers/specs/2026-08-21-production-ready-planner-design.md`

## Global Constraints

- CI starts from clean checkout and clean dependency install.
- Production images run non-root and contain no development credentials.
- Deployment steps that require cloud credentials remain documented user actions.
- Fixture release is visibly demo-only.

---

### Task 1: Browser E2E and accessibility suite

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/planner.spec.ts`
- Create: `apps/web/e2e/errors.spec.ts`
- Create: `apps/web/e2e/account.spec.ts`
- Create: `apps/web/e2e/accessibility.spec.ts`

**Interfaces:**
- `npm run e2e --workspace @webreg/web` starts localhost app with seeded demo database.

- [ ] Add Playwright and `@axe-core/playwright` after verifying dependencies are absent.
- [ ] Cover guest search/plan/conflict/calendar/finals, schedule CRUD, term switch persistence, authenticated persistence, retry states, export, and deletion.
- [ ] Assert the cannot-enroll/demo notices and absence of official enrollment controls.
- [ ] Run axe on planner, dialog, privacy, and terms views; allow no serious/critical violations.
- [ ] Run Chromium desktop and 375px mobile projects.
- [ ] Commit: `test: add planner e2e`

### Task 2: CI release gates

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`
- Modify: `package.json`

- [ ] Configure PostgreSQL 16 and Redis 7 services with health checks and test-only credentials.
- [ ] Use declared Node 20 and current LTS matrix, `npm ci`, Prisma generate/migrate, demo seed, unit/integration tests, clean typecheck, lint, web/worker builds, E2E, `npm audit --omit=dev`, and secret scan.
- [ ] Upload Playwright traces/screenshots only on failure; never upload `.env` or database dumps.
- [ ] Add concurrency cancellation and least-privilege workflow permissions.
- [ ] Run equivalent commands locally from a clean temporary clone/worktree.
- [ ] Commit: `ci: add release gates`

### Task 3: Production containers

**Files:**
- Create: `Dockerfile.web`
- Create: `Dockerfile.worker`
- Create: `.dockerignore`
- Modify: `apps/web/next.config.ts`

- [ ] Enable Next standalone output and build a multi-stage web image.
- [ ] Build worker `dist` in a multi-stage image; final stage installs production dependencies only.
- [ ] Create non-root runtime users, explicit health checks, read-only-compatible filesystems, and SIGTERM-compatible commands.
- [ ] Build both images locally and inspect history for secrets/source `.env`.
- [ ] Run containers against disposable PostgreSQL/Redis; verify web readiness and worker fixture startup.
- [ ] Commit: `deploy: add production images`

### Task 4: Railway deployment contract

**Files:**
- Create: `railway.toml`
- Create: `docs/deployment/railway.md`
- Create: `scripts/migrate-production.mjs`
- Modify: `.env.example`

- [ ] Define separate web/worker service settings and a one-shot migration command; never auto-run migrations concurrently in app replicas.
- [ ] Document exact `APP_ORIGIN`, proxy hops, TLS Redis/PostgreSQL, Google OAuth callback, runtime/migration roles, generated secrets, service health paths, and demo-source flag.
- [ ] Make migration script validate production env, run `prisma migrate deploy`, and exit before app rollout.
- [ ] Document first deploy, smoke check, rollback to prior image, and secret rotation.
- [ ] Validate Railway config locally and dry-run migration against disposable PostgreSQL.
- [ ] Commit: `deploy: add Railway config`

### Task 5: Operations and final release proof

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `docs/operations/backup-restore.md`
- Create: `docs/operations/incident-response.md`
- Create: `docs/operations/catalog-failure.md`
- Create: `docs/operations/release-checklist.md`
- Modify: `.superpowers/sdd/progress.md`

- [ ] Document local setup, architecture, demo-data boundary, commands, privacy model, and explicit non-affiliation.
- [ ] Add the chosen repository license and ensure UI claim matches it.
- [ ] Document encrypted backup schedule, quarterly restore drill, recovery verification, retention, and accountable owner fields as deployment inputs rather than fictional completed controls.
- [ ] Document incident classification, secret compromise, bad catalog rollback, user notification, and support escalation.
- [ ] Run every spec release gate; record commands, versions, timestamps, and results in release checklist.
- [ ] Confirm remaining blockers list contains only external live-TSS authorization/schema and actual cloud credential actions.
- [ ] Commit: `docs: add release runbooks`

## Unresolved Questions

- Railway project/account credentials and operational owner are required only for actual cloud deployment.
- Live TSS authorization/schema remains deferred.
