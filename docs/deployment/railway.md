# Railway deployment

Production uses three Railway services from one repository. Configure each service's absolute config-file path in Railway; a monorepo root does not change this path.

| Service | Config path | Dockerfile | Health/restart |
| --- | --- | --- | --- |
| `web` | `/railway.web.toml` | `Dockerfile.web` | `GET /api/ready`, `ON_FAILURE` |
| `worker` | `/railway.worker.toml` | `Dockerfile.worker` | no HTTP health path, `ON_FAILURE` |
| `migrate` | `/railway.migrate.toml` | `Dockerfile.migrate` | one shot, `NEVER` |

Disable automatic deployment triggers for `migrate`. Do not use a web or worker pre-deploy command: run the isolated migration service, require success, then deploy both long-running services.

## Required variables

Use Railway sealed variables or an external secret manager. Never commit values.

All three services:

- `NODE_ENV=production`
- `DATABASE_URL=postgresql://web_runtime:…@external-db.example:5432/webreg?sslmode=require&sslaccept=strict`

`migrate` only:

- `MIGRATION_DATABASE_URL=postgresql://web_migrator:…@external-db.example:5432/webreg?sslmode=require&sslaccept=strict`

The runtime and migration URLs must differ. Use separate least-privilege roles: runtime gets application DML; migrator gets schema migration privileges. Both endpoints must be external managed PostgreSQL with a public CA-verifiable hostname. Prisma's PostgreSQL connector requires the exact pair `sslmode=require&sslaccept=strict`; `sslmode=verify-full` is not accepted by this deployment contract. Do not give `MIGRATION_DATABASE_URL` to `web` or `worker`.

`web` only:

- `APP_ORIGIN=https://planner.example.edu`
- `AUTH_URL=https://planner.example.edu` (exactly equal to `APP_ORIGIN`)
- `NEXTAUTH_SECRET=<at least 32 random bytes>`
- `GOOGLE_CLIENT_ID=<Google OAuth client>`
- `GOOGLE_CLIENT_SECRET=<Google OAuth secret>`
- `REDIS_URL=rediss://:<secret>@external-redis.example:6380`
- `TRUSTED_PROXY_HOPS=1` for direct Railway ingress
- `ENABLE_HSTS=true` only after confirming the public origin is HTTPS-only and Railway/upstream HSTS is reconciled
- `CONTACT_EMAIL=planner-ops@example.edu`
- `CATALOG_SOURCE=fixture`

`worker` only:

- `CONTACT_EMAIL=planner-ops@example.edu`
- `CATALOG_SOURCE=fixture`

Production intentionally supports fixture catalog data only. Do not configure `legacy-soc` or `tss`. Railway's bundled Redis URL is not acceptable when it is `redis://`; production requires an external TLS endpoint using `rediss://`.

If another proxy/CDN sits before Railway, set `TRUSTED_PROXY_HOPS` to the exact total trusted hop count and retest origin enforcement. Never enable broad forwarded-host trust.

## OAuth

Create a Google web OAuth client for the canonical public origin. Configure exactly:

- JavaScript origin: `https://planner.example.edu`
- Redirect URI: `https://planner.example.edu/api/auth/callback/google`

The browser origin, `APP_ORIGIN`, `AUTH_URL`, and Google callback host must match exactly. Update all four together during a domain change.

## Deploy

Install and authenticate the Railway CLI, link the production project/environment, and verify the selected target before any mutation:

```sh
railway status
railway whoami
```

Deploy the migration service and require a successful one-shot exit:

```sh
railway up --service migrate --environment production --ci
railway logs --latest --service migrate --environment production
```

Treat the attached `railway up --ci` exit status as the migration decision. `--latest` is required when inspecting logs so a failed newest deployment cannot be confused with an older successful deployment; retain the deployment ID in release evidence.

The migration runner refuses non-production execution, identical database URLs, or PostgreSQL URLs without exactly one `sslmode=require` and one `sslaccept=strict`. It invokes `prisma migrate deploy` directly without a shell, caps execution at two minutes, and sanitizes errors.

Prove idempotency before the first release by deploying the same migration image twice against a disposable TLS-verified database. The second run must exit successfully with no pending migrations. Then deploy runtime services:

```sh
railway up --service web --environment production --ci
railway up --service worker --environment production --ci
```

Confirm `https://planner.example.edu/api/live` and `https://planner.example.edu/api/ready` return 200. `/api/ready` is Railway's deploy gate and verifies dependencies; `/api/live` is process liveness. The worker deliberately has no HTTP health path.

Rollback application images independently. Never roll back a database by rerunning an older migration image; use a reviewed forward migration or a tested restore procedure.

Railway references: [Config as Code](https://docs.railway.com/config-as-code/reference), [monorepos](https://docs.railway.com/deployments/monorepo), [health checks](https://docs.railway.com/deployments/healthchecks), [restart policy](https://docs.railway.com/deployments/restart-policy), and [variables](https://docs.railway.com/variables).
