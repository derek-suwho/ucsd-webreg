# Release checklist

This is an evidence ledger, not a claim that production exists. Check a gate only after verifying the exact release candidate; link durable evidence without secrets or personal data.

## Candidate record

| Field | Value |
| --- | --- |
| Candidate commit SHA | `[record after clean lineage is established]` |
| Release/version | `[assign]` |
| UTC verification window | `[record]` |
| Release operator | `[assign]` |
| Security reviewer | `[assign]` |
| Legal/name/data approver | `[assign]` |
| Railway project/environment | `[record identifier, no credentials]` |
| Evidence location | `[restricted durable location]` |

## Existing repository evidence

These records describe observed local work before the final candidate. They do not replace a clean-candidate rerun.

| SHA/evidence label | Observed evidence |
| --- | --- |
| `fcec890` | Reliable save queue final review; 76 focused tests, type/lint checks |
| `bbe2a01` | Dynamic term/demo shell; 88 focused tests and production web build |
| `e6c0085` | Planner accessibility follow-up; full suite reported 382 passing |
| `901bad3`, `2cd7826` | Responsive/print shell; exact-worktree List/Calendar/Finals, 320/375/768/1440 and print evidence; full suite reported 394 passing/107 DB-skipped |
| `dc3d89d`, `897d89b` | Account export/deletion, Privacy/Terms, trust-copy integration; focused 16 and full 390 passing/107 DB-skipped |
| `bb3346c` | Release E2E harness using a dedicated `_e2e` database, genuine Auth.js JWT cookie, Chromium desktop/375, and axe |
| `04669ed`, `b1e75e5` | CI service verification and cleanup hardening |
| `6064aa2` | Dependency/lock remediation; current `npm audit --omit=dev` reports zero production vulnerabilities; candidate audit still required |
| `9b2140d` | Three Railway configs passed official schema; migration tests 12/12; disposable PostgreSQL deploy twice, second run had no pending migrations; full local suite 435 passing/107 DB-skipped |
| `21ecf10` | Production images/readiness; focused readiness/route/worker signal tests 25/25 and three Docker static checks without warnings |
| `WORKTREE-TLS-PENDING` | Prisma-supported `sslmode=require&sslaccept=strict` correction exists in the shared worktree; no clean-lineage commit/evidence may be claimed yet |

## Product and catalog boundary

- [ ] Candidate visibly says `Unofficial planning tool — cannot enroll` in header and footer.
- [ ] Candidate identifies as independent/nonaffiliated and uses no official logo.
- [ ] No enroll/drop/waitlist/reservation controls or claims exist.
- [ ] Production has explicit `CATALOG_SOURCE=fixture`; non-fixture values fail startup.
- [ ] UI says `Demo catalog — not live seat data` and shows the snapshot publication timestamp without calling it fixture freshness.
- [ ] Full non-cancelled sections remain planning-only; cancelled sections are inspectable but not plannable.
- [ ] Live TSS remains disabled and receives no credentials/session material.
- [ ] Owner has resolved UCSD name, interface, content, and data permissions for launch.

## Legal, privacy, and repository lineage

- [ ] Privacy/Terms reviewed by accountable legal/privacy owner for deployed providers and retention.
- [ ] Repository license selected; `LICENSE` added; UI/repository claims match it.
- [ ] Until then, no license claim appears in UI or release materials.
- [ ] Archived cookie is nonfunctional in the working tree.
- [ ] Secret scan covers current tree and complete history.
- [ ] History cleanup/rotation decision is documented and completed before any public mirror.
- [ ] Candidate SHA descends from reviewed commits with a clean, auditable lineage.
- [ ] No untracked/dirty production files are required by the candidate.

## Clean install and automated gates

- [ ] Clean checkout on declared Node 22/npm 11.18: `corepack npm ci`.
- [ ] Clean checkout on declared Node 24/npm 11.18: `corepack npm ci`.
- [ ] Prisma generate/migrations succeed against disposable PostgreSQL.
- [ ] `corepack npm run test:ci` passes with disposable PostgreSQL/Redis; every skip is named and justified.
- [ ] `corepack npm run typecheck:clean` passes.
- [ ] `corepack npm run lint:ci` passes with zero warnings.
- [ ] `corepack npm run build:web` passes with explicit non-secret build-only environment.
- [ ] `corepack npm run build:worker` passes.
- [ ] `corepack npm audit --omit=dev` reviewed with no unaccepted production finding.
- [ ] CodeQL, secret scan, and dependency-review jobs pass; findings are triaged.
- [ ] Hosted CI run for the exact candidate SHA is green; link run: `[add]`.

## Browser, accessibility, and visual proof

- [ ] Dedicated disposable `_e2e` database confirmed; never shared with development/staging/production.
- [ ] Playwright passes in Chromium desktop and 375 mobile for the exact candidate.
- [ ] Guest planning/conflicts/views/reload and schedule CRUD pass.
- [ ] Term switching and terms/catalog/save retry flows pass.
- [ ] Authenticated save/reload/export/account deletion pass with ownership checks.
- [ ] Axe reports no serious/critical violations on planner, populated dialog, Privacy, and Terms.
- [ ] Keyboard-only pass covers skip link, search, course planning, dialogs, tabs, schedule controls, scroll regions, and account actions.
- [ ] Final screenshot comparison read at 1440; responsive overflow checked at 320/375/768/1440.
- [ ] Canonical print includes identity, notice, term/schedule/provenance/timestamp, and planned rows without Action column.

## Database, backups, and TLS

- [ ] External managed PostgreSQL provisioned; public hostname validates against trusted CA.
- [ ] Separate least-privilege runtime, migration, and backup roles verified.
- [ ] Production connection contract uses Prisma-supported `sslmode=require&sslaccept=strict`.
- [ ] Backup/restore libpq service uses its driver-native `sslmode=verify-full` and trusted CA settings.
- [ ] Integration proof rejects plaintext PostgreSQL and invalid hostname/certificate; valid trusted TLS succeeds.
- [ ] Migration runner uses only migration credentials, no shell, sanitized output, and bounded execution.
- [ ] Same migration image succeeds twice against disposable TLS-verified PostgreSQL.
- [ ] Provider snapshots/PITR and encrypted logical dumps configured.
- [ ] Owner/RPO/RTO/PITR/retention inputs in [backup/restore](backup-restore.md) approved.
- [ ] Quarterly restore drill passed; link evidence: `[add]`.

## Redis, edge, OAuth, and secrets

- [ ] External managed Redis uses `rediss://`; plaintext connection rejected.
- [ ] Redis failure makes production rate limiting/readiness fail closed.
- [ ] `APP_ORIGIN` and `AUTH_URL` equal the exact HTTPS public origin.
- [ ] Google origin and callback exactly match `<origin>/api/auth/callback/google`.
- [ ] `TRUSTED_PROXY_HOPS` matches measured edge path; origin/IP behavior tested through real edge.
- [ ] CSP/HSTS/security headers reconciled with Railway/upstream edge.
- [ ] Generated Auth.js/OAuth/database/Redis/deployment secrets injected through secret manager.
- [ ] Rotation owners/procedure tested; no value appears in image history, logs, CI artifacts, or tickets.

## Images and Railway

- [ ] Web, worker, and migration images built from exact clean candidate.
- [ ] Hosted three-image build job passes exact runtime-user, command, and health-metadata assertions.
- [ ] Image digests/SBOMs recorded; vulnerability findings reviewed.
- [ ] Final images run as non-root and pass a read-only-root-filesystem smoke where supported.
- [ ] Image history/context contain no `.env`, credentials, test database, source session material, or development-only secrets.
- [ ] Web standalone starts and `/api/live` responds.
- [ ] `/api/ready` returns 200 only with PostgreSQL/Redis; dependency loss produces bounded 503 and later recovery.
- [ ] Worker fixture import/startup and SIGTERM cleanup pass; worker has no HTTP health path.
- [ ] Migration service is one-shot with restart policy `NEVER`; automatic migration deploy triggers disabled.
- [ ] Railway credentials/project/services/domains/variables configured by authorized operator.
- [ ] Migration succeeds before web/worker rollout; concurrent app migrations impossible.

## Smoke, rollback, and operations

- [ ] Production UI notice/provenance and Privacy/Terms checked at public origin.
- [ ] Liveness, readiness, and catalog health checked independently.
- [ ] Guest schedule smoke passes.
- [ ] Controlled test account can save/reload/export/delete schedules; cleanup confirmed.
- [ ] No personal data or secret appears in logs during smoke.
- [ ] Prior immutable image identifiers and schema compatibility recorded.
- [ ] Application rollback exercised without reversing schema migrations.
- [ ] Catalog last-good recovery exercised using reviewed fixture/backup.
- [ ] Monitoring/alerts, incident roles/channels, and provider escalations configured.
- [ ] Backup failure, secret compromise, bad catalog, and dependency outage runbooks reviewed by owners.

## Approval

| Gate | Approver | UTC time | Evidence |
| --- | --- | --- | --- |
| Engineering | `[pending]` | | |
| Security/privacy | `[pending]` | | |
| Legal/name/data use | `[pending]` | | |
| Operations/backup | `[pending]` | | |
| Release owner | `[pending]` | | |

Release only when every applicable item is checked and the remaining deferred item is explicitly accepted by an authorized owner. Live TSS authorization/implementation is not required for a fixture-only demo release; enabling it is a separate release.
