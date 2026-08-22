# Backup and restore

This runbook defines required controls. It does not claim a provider, schedule, owner, backup, or restore drill exists until evidence is recorded.

## Required decisions

Complete before production:

| Input | Required value |
| --- | --- |
| Accountable owner | `[assign person/team]` |
| Backup provider/plan | `[select]` |
| Production database identifier/region | `[record without credentials]` |
| RPO | `[approve duration]` |
| RTO | `[approve duration]` |
| PITR window | `[approve duration]` |
| Logical-backup frequency | `[approve schedule]` |
| Backup retention | `[approve duration and deletion alignment]` |
| Restore-drill cadence | Quarterly |
| Backup encryption/key owner | `[record system/team]` |
| Evidence location | `[restricted location]` |

RPO, RTO, and retention are business/operational decisions. Do not invent defaults in a release record.

## Scope

Back up:

- PostgreSQL account profiles, schedules, terms, catalog rows, import runs, and published snapshots.
- Deployment configuration needed to reconstruct services, excluding secret values.
- A portable logical PostgreSQL dump in addition to provider snapshots/PITR.

Do not treat these as backups:

- Redis rate-limit counters; they are short-lived operational state.
- Guest schedules; they remain only in each browser.
- Application logs; they have a separate access/retention policy and may contain personal identifiers.
- Source-controlled demo fixtures; they help rebuild demo catalog data but not user schedules.

## Production controls

- Use an external managed PostgreSQL service with encrypted storage, TLS certificate verification, network restrictions, and separate runtime/migration/backup roles. Application/Prisma URLs use exactly `sslmode=require&sslaccept=strict`; backup tools must use their own driver-native equivalent.
- Enable provider-native automated snapshots and point-in-time recovery.
- Store logical dumps in a different failure domain with server-side encryption, versioning/immutability where available, least-privilege access, and lifecycle deletion.
- Alert on failed/missed backups and expiring PITR windows.
- Never place database URLs, passwords, dumps, or provider tokens in the repository, CI artifacts, tickets, or chat.
- Verify backup retention against account-deletion/privacy commitments with legal and security owners.

## Logical backup

Use a restricted libpq service definition and password file rather than a URL in shell history. Configure libpq itself with `sslmode=verify-full` and its trusted CA setting; `sslaccept=strict` is Prisma-specific. The backup role should have only the privileges required to dump the database.

```sh
umask 077
BACKUP_FILE="webreg-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --dbname="service=webreg-backup" --format=custom --no-owner --no-acl --file="$BACKUP_FILE"
sha256sum "$BACKUP_FILE" >"$BACKUP_FILE.sha256"
pg_restore --list "$BACKUP_FILE" >/dev/null
```

Upload the dump and checksum through the approved encrypted backup channel. Record object identifier, timestamp, source database, tool version, checksum, and retention class. Do not print or attach dump contents.

## Quarterly restore drill

Restore only into an isolated, access-restricted database with no production traffic or OAuth callbacks.

1. Assign drill owner and incident-free maintenance window.
2. Select a backup/PITR timestamp according to the approved RPO.
3. Create a new empty restore database and dedicated temporary credentials.
4. For a logical dump, verify its checksum and inspect `pg_restore --list`.
5. Restore without ownership/ACL assumptions:

   ```sh
   pg_restore --dbname="service=webreg-restore" --no-owner --no-acl --exit-on-error "$BACKUP_FILE"
   ```

6. Apply only reviewed forward migrations needed by the candidate application.
7. Validate schema migration state, row-count ranges, foreign keys, representative schedule ownership/items, terms, snapshot provenance, and application readiness.
8. Start an isolated candidate web instance and verify sign-in is disabled or restricted; exercise read-only schedule/catalog smoke checks.
9. Measure recovery point and elapsed recovery time against approved RPO/RTO.
10. Destroy the isolated restore database and temporary credentials after evidence review.

Record date, owners, backup identifier, target, commands/tool versions, checksum, RPO/RTO results, validation results, issues, and deletion confirmation. A planned or attempted drill is not a passed drill.

## Point-in-time recovery

Use the provider's documented PITR workflow; commands differ by provider. Before executing:

- confirm target timestamp and timezone with the incident lead;
- restore to a new database, never over the only production copy;
- freeze writes or define a reconciliation plan;
- preserve the original database for investigation;
- validate the restored candidate before changing service URLs;
- rotate temporary access and record the cutover/rollback decision.

## Failed backup or restore

- Page the accountable owner and open an incident if RPO coverage is at risk.
- Do not delete the last known-good backup during troubleshooting.
- Preserve sanitized provider/job errors and timestamps.
- Re-establish a successful backup, verify it, then close the incident.
- If restore validation fails, keep production unchanged and escalate; do not waive integrity checks to meet RTO silently.

See [incident response](incident-response.md) and [release checklist](release-checklist.md).
