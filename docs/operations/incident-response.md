# Incident response

This runbook is a template. Fill accountable people and channels before production; placeholders are not operational coverage.

## Required inputs

| Role/input | Required value |
| --- | --- |
| Incident commander | `[assign]` |
| Security/privacy lead | `[assign]` |
| Database/backup lead | `[assign]` |
| Communications/legal approver | `[assign]` |
| Hosting/OAuth escalation contacts | `[record privately]` |
| Paging channel | `[configure]` |
| Restricted evidence location | `[configure]` |
| User support channel | `[configure]` |

Never put secrets, cookies, database URLs, access tokens, raw personal data, or database dumps in incident chat or tickets.

## Severity

| Severity | Examples | Response |
| --- | --- | --- |
| SEV-1 | confirmed credential/PII disclosure, cross-user schedule access, destructive database event, total production loss without recovery | immediate page; incident command and containment |
| SEV-2 | sustained sign-in/save outage, corrupted published catalog, missed backup threatening RPO, Redis/rate-limit failure | urgent owner response |
| SEV-3 | degraded noncritical view, isolated worker failure with last-good snapshot intact | working-hours response unless escalating |

Catalog accuracy can affect decisions even though the tool cannot enroll. Treat materially wrong published course data as at least SEV-2 until contained.

## Response flow

1. **Declare:** assign incident ID, severity, commander, start time, and affected environment.
2. **Protect:** stop unsafe deployment/sync/write paths; preserve the last known-good image, snapshot, database, and logs.
3. **Scope:** identify affected users, terms, schedules, services, data classes, and time window without copying raw data into notes.
4. **Contain:** revoke or rotate compromised access, disable a source/service, or route traffic to a verified prior image.
5. **Eradicate:** fix the root cause with review and the committed Corepack/CI command contract; do not patch production manually without recording it.
6. **Recover:** migrate once if required, deploy, verify liveness/readiness/catalog provenance/schedule persistence, and monitor.
7. **Communicate:** use approved factual language; do not speculate about impact or legal notification duties.
8. **Review:** publish a sanitized timeline, root cause, control gaps, actions, owners, and due dates.

## Security or privacy event

- Preserve authentication, deployment, database, and access-control logs under restricted access.
- Disable affected credentials or endpoints before broad investigation if exposure is active.
- Determine whether account profile fields, schedule data, session material, or infrastructure credentials were exposed.
- Engage privacy/legal owners to decide notification scope and timing. Source code does not define statutory obligations.
- Do not promise deletion from provider backups/logs beyond configured and verified retention.
- After containment, test ownership, exact-origin enforcement, session invalidation, export, deletion, and audit/log redaction.

## Secret rotation

Prefer overlap-capable rotations: create a new credential, deploy consumers, verify, then revoke the old credential. For confirmed compromise, revoke immediately if continued exposure outweighs outage risk.

Rotate as applicable:

1. Railway/project and CI/CD tokens.
2. PostgreSQL runtime, migration, and backup roles independently.
3. Redis credentials/TLS endpoint.
4. Google OAuth client secret and exact callback/origin configuration.
5. Auth.js `NEXTAUTH_SECRET`; this intentionally invalidates existing sessions.
6. Backup encryption/provider credentials and webhook/monitoring tokens.

After each rotation, verify the credential at its actual boundary:

- deployment/CI tokens: authorized identity and intended project/environment only;
- runtime PostgreSQL and Redis: `/api/ready`, rate limiting, and an owned schedule save/reload;
- migration role: one-shot migration status with no pending migration;
- backup role: a bounded dump plus `pg_restore --list` validation through the approved channel;
- Google OAuth and Auth.js: callback, new sign-in/session, and invalidation of the prior session/secret;
- worker source/database access: one complete fixture startup with expected provenance;
- monitoring/webhook credentials: a test event reaches the restricted destination.

In every case, verify the old credential fails, the new value reaches only intended services, and logs contain no value. Record identifiers/versions, never secret values.

## Service rollback

- Prefer immutable prior images from the same reviewed lineage.
- Run migrations as a separate one-shot step; never start concurrent migrations from web/worker replicas.
- Do not undo database schema by deploying an older image. Use a reviewed forward migration or restore plan.
- If the prior image is incompatible with the current schema, keep it out of service and escalate.
- After rollback, verify `/api/live`, `/api/ready`, catalog status, guest planning, authenticated schedule read/write, and account boundaries.

## Catalog incident

Do not switch from fixture to legacy/TSS to restore availability. Keep or restore the last known-good published snapshot and follow [catalog failure recovery](catalog-failure.md).

## Evidence and closure

Minimum sanitized record:

- incident ID, severity, owners, start/detect/contain/recover/end times;
- affected service/data classes and bounded user/term counts;
- deployment and migration identifiers;
- log/provider evidence locations and retention holds;
- recovery checks and monitoring window;
- notification decision owner;
- corrective actions with owner and due date.

Close only after containment is durable, recovery evidence passes, monitoring is stable, temporary access is revoked, and follow-up work is tracked.
