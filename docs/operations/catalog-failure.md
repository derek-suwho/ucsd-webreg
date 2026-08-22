# Catalog failure recovery

The production release is fixture/demo-only. Catalog recovery must preserve that boundary and the visible `Demo catalog — not live seat data` wording.

## Signals

- `/api/live` answers whether the web process responds.
- `/api/ready` checks PostgreSQL and Redis availability.
- `/api/health` reports active-term import/snapshot health.
- Worker logs emit bounded failure categories without upstream bodies, URLs, credentials, or personal data.
- The UI shows snapshot provenance and an absolute generated timestamp.

A ready web service can still have unhealthy or inaccurate catalog data. Diagnose these signals separately.

## Failure classes

| Failure | Expected public behavior | Operator action |
| --- | --- | --- |
| Fixture file/ownership validation fails before publish | Previous snapshot remains served | stop restart churn; inspect release artifact |
| Department normalization/import fails | Import run fails; previous snapshot remains served | inspect bounded category/term; do not publish partial data |
| Snapshot size/build fails | Previous snapshot remains served | keep configured bounds; investigate fixture/change |
| PostgreSQL unavailable | readiness 503; writes/import unavailable | database incident/restore runbook |
| Redis unavailable | readiness 503; production rate limits fail closed | external Redis incident; do not bypass limiter |
| Bad fixture successfully published | Bad current snapshot served | contain and restore known-good fixture/backup |

## Immediate response

1. Declare an incident and record affected environment, term, first observed time, and current image identifier.
2. Confirm the UI still labels the source Demo. If not, remove traffic immediately.
3. Pause repeated worker deployments/restarts if they create noise or load.
4. Preserve sanitized worker logs, latest `ImportRun` category, snapshot version/provenance/timestamp, and prior image identifier.
5. Do not edit production database rows by hand, raise snapshot limits without measurement, or switch `CATALOG_SOURCE`.
6. Verify saved schedules remain intact; catalog recovery must not delete user schedules.

## Failed import with last-good snapshot

Failed syncs do not publish a new snapshot. Keep serving the prior snapshot only if:

- its provenance remains `fixture`/`demo`;
- the UI states the generated timestamp without claiming freshness;
- no known safety/legal reason requires taking the planner offline.

Repair the fixture/code in review, reproduce the failure locally, run fixture ownership/normalization/snapshot tests, then pass the committed Corepack/CI gates before normal deployment. A later complete sync reconciles underlying catalog rows and publishes a new snapshot.

## Bad snapshot already published

There is one current snapshot row per term, not an application-level snapshot history. Recovery sources are therefore:

1. the reviewed known-good fixture and immutable application/worker image; or
2. a verified PostgreSQL backup/PITR restore.

Preferred fixture recovery:

1. Identify the last reviewed image/fixture that produced correct demo output.
2. Confirm it is schema-compatible; do not roll back database migrations.
3. Deploy/run that worker artifact with `CATALOG_SOURCE=fixture` once.
4. Require a successful complete term sync and new demo snapshot.
5. Verify term/course/section counts against fixture ownership expectations.
6. Check representative open/full/unlimited/cancelled sections, meetings, finals, conflicts, provenance, and generated timestamp.
7. Restore normal worker service only after verification.

If fixture recovery cannot establish integrity, use [backup/restore](backup-restore.md) to restore into an isolated database, validate, then plan a controlled cutover. Never overwrite the only production database during investigation.

## Legacy/TSS failures

Legacy SoC is not a production fallback. TSS is disabled and must not receive student credentials, cookies, or captured authenticated responses. An upstream outage does not authorize scraping, republishing, or weakening the fixture boundary.

Live-source enablement requires a separate approved release satisfying [catalog source gates](../architecture/catalog-sources.md).

## Verification before closure

- Worker completed exactly one successful fixture sync per affected term.
- `/api/live`, `/api/ready`, and `/api/health` return expected status.
- Public catalog payload and UI show `fixture`/`demo` provenance.
- Displayed snapshot publication timestamp matches the public payload; source provenance retains the reviewed fixture timestamp; no live-seat wording appears.
- Representative planner List/Calendar/Finals and schedule persistence work.
- No partial term, ownership mismatch, new normalization warning, or bound override remains.
- Monitoring is stable for the agreed window.
- Root cause and a regression test/check are recorded.

Follow [incident response](incident-response.md) for severity, communications, rotation, and closure evidence.
