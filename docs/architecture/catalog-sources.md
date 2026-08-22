# Catalog sources

## Release boundary

Production is fixture-only. Every fixture snapshot is demo data, not live seat data. The UI timestamp identifies when the snapshot was published; it does not establish when the fixture was authored or that its contents are current. Source provenance separately carries the fixture's authored timestamp.

Never switch production to another source as an outage fallback. Source changes require authorization, schema review, reconciliation tests, freshness monitoring, and a separate release.

## Contract

`CatalogSource` isolates worker orchestration from source-specific transport:

```ts
interface CatalogSource {
  readonly kind: 'fixture' | 'legacy-soc' | 'tss'
  readonly knownTermIds: readonly string[]
  listTerms(): Promise<SourceTerm[]>
  fetchDepartment(termId: string, department: string): Promise<ScrapedCourse[]>
}
```

All sources pass through the same validation, normalization, term-scoped PostgreSQL writes, snapshot limits, provenance, and public catalog API.

Production catalog/database processes require application URLs with exactly `sslmode=require&sslaccept=strict`. Source changes must pass the committed Node 22/24 CI contract (`corepack npm run test:ci`, types, lint, builds, audit, and E2E) before release.

## Source matrix

| Source | Status | Provenance | Allowed use |
| --- | --- | --- | --- |
| `fixture` | Enabled | `mode: demo` | Local, test, and production demo release |
| `legacy-soc` | Implemented for an explicit pre-FA26 allowlist | `mode: live` when successfully synchronized | Local/manual compatibility work only; not production |
| `tss` | Disabled adapter boundary | none | No use until authorization and implementation gates pass |

Production environment validation rejects any `CATALOG_SOURCE` other than explicit `fixture`.

## Fixture guarantees

`packages/catalog/fixtures/fa26-demo.json` is sanitized release data. It must contain no student record, credential, cookie, token, or authenticated response capture.

The fixture covers representative planner behavior, including:

- lecture/discussion/lab families;
- open, full, unlimited, and cancelled sections;
- waitlists and variable units;
- TBA meetings, finals, and time conflicts.

Fixture import verifies expected term/course/section ownership before publishing a snapshot. Provenance must use `sourceKind: fixture` and `mode: demo`; schema validation rejects fixture provenance labeled live.

## Synchronization flow

```text
CatalogSource
  -> validated terms/departments
  -> normalized courses/sections
  -> term-scoped catalog writes under a PostgreSQL advisory lock
  -> bounded CatalogSnapshot with provenance
  -> /api/catalog/:termId
  -> browser search and planner views
```

The worker publishes a new snapshot only after every department for a term succeeds. A failed prefetch or snapshot build records a failed `ImportRun` and leaves the previously published snapshot available. Underlying staging rows may have partial writes if failure occurs after writes begin; the public API still serves the prior snapshot until a later complete sync publishes again.

The public signals are intentionally separate:

- `/api/live`: web process liveness only.
- `/api/ready`: PostgreSQL and Redis dependency readiness.
- `/api/health`: catalog/import health.
- Catalog status in the UI: snapshot source and generated timestamp.

Do not use readiness to claim catalog freshness, or a generated timestamp to claim live seats.

## Legacy source

The legacy Schedule of Classes adapter is constrained to known pre-FA26 terms. It uses bounded response sizes, page/row limits, concurrency, retries, and a project contact address. It does not justify production use and must not ingest authenticated student sessions.

Upstream instability, HTML changes, incomplete departments, or ownership mismatches fail the sync. Operators must not publish partial output or silently substitute fixture/live provenance.

## TSS boundary

`TssSource` always throws `TSS source disabled`. It must remain disabled until all of these are complete:

- written UCSD authorization to automate and republish the required fields;
- sanitized course-response schema with no student/session data;
- service authentication design that never uses student credentials or session cookies;
- parser/adapter, reconciliation, failure, and freshness tests;
- monitored production freshness and upstream-change alerts;
- reviewed user-facing provenance and legal language.

## Failure recovery

For fixture failures, keep the last published snapshot, stop repeated worker churn, and redeploy/re-import a reviewed known-good fixture. For a bad snapshot already published, recover from the known-good fixture image or a verified database backup; there is only one current snapshot row per term.

See [catalog failure recovery](../operations/catalog-failure.md) and [backup/restore](../operations/backup-restore.md).
