# Course Planner

Course Planner is an independent, planning-only schedule builder for UC San Diego students.

> **Unofficial planning tool — cannot enroll.** This project is not affiliated with or endorsed by the University of California, UC San Diego, or its registration services. Verify every course detail in the official system.

The current release uses sanitized fixture/demo catalog data. It does not provide live seat data and cannot enroll, drop, waitlist, reserve seats, or change university records.

## Features

- Search fixture courses and inspect open, full, unlimited, and cancelled sections.
- Plan full non-cancelled sections without implying a seat reservation.
- Compare List, Calendar, and Finals views with conflict warnings.
- Create, rename, copy, and delete schedules.
- Keep guest schedules in the browser or save signed-in schedules to an account.
- Export signed-in schedules and delete the account from the planner.

## Repository

This npm-workspaces modular monolith contains:

- `apps/web`: Next.js UI, Auth.js, and JSON APIs.
- `apps/worker`: fixture/catalog synchronization process.
- `packages/catalog`: source contracts, normalization, persistence, and snapshots.
- `packages/planner`: pure selection and conflict logic.
- `packages/search`: client-side catalog search.
- `packages/config`: environment validation.
- `packages/db`: Prisma schema and PostgreSQL client.

See [catalog source architecture](docs/architecture/catalog-sources.md), [Railway deployment](docs/deployment/railway.md), and [operations](docs/operations/release-checklist.md).

## Local setup

Requirements:

- Node.js `^22.12.0` or `^24.0.0`
- npm `11.18.0` through Corepack
- Docker with Compose

Install dependencies:

```sh
corepack enable
corepack npm ci
cp .env.example .env
chmod 600 .env
```

Replace every placeholder in `.env` with a local-only value. Never reuse production secrets. Load the file into the current shell, then start loopback PostgreSQL and Redis:

```sh
set -a
. ./.env
set +a
docker compose --env-file .env up -d db redis
```

Apply migrations and import the demo fixture:

```sh
corepack npm exec -- prisma migrate deploy --schema packages/db/prisma/schema.prisma
corepack npm run seed:demo
```

Start the web app:

```sh
corepack npm run dev --workspace @webreg/web
```

Open `http://localhost:3000`. Guest planning works without Google OAuth. To exercise the long-running fixture worker instead of `seed:demo`, run this in another shell with the same environment:

```sh
corepack npm run dev --workspace @webreg/worker
```

Stop local services with `docker compose down`. Do not add `-v` unless intentionally deleting the local development database volume.

## Verification

```sh
corepack npm test
corepack npm run typecheck:clean
corepack npm run lint:ci
corepack npm run build:web
corepack npm run build:worker
```

`corepack npm run verify` runs tests, type checks, lint, and production builds. Database-backed tests require an explicit disposable `DATABASE_URL`; Redis-backed CI verification requires `REDIS_URL`. Production web builds also require the validated production-shaped environment shown in the CI workflow.

Browser tests require a dedicated PostgreSQL database whose name ends in `_e2e`:

```sh
TEST_DATABASE_URL="$E2E_DATABASE_URL" corepack npm run e2e --workspace @webreg/web
```

The E2E setup resets that database. Never point it at development, staging, or production.

## Production boundary

Production uses separate web, worker, and one-shot migration services, plus external PostgreSQL and Redis:

- Application/migration PostgreSQL URLs must contain exactly `sslmode=require&sslaccept=strict` and use separate runtime/migration roles.
- Redis must use `rediss://`.
- `CATALOG_SOURCE=fixture` is mandatory.
- Google OAuth origin and callback must exactly match the public application origin.
- Secrets belong in the deployment secret store, never image layers, files, logs, or command history.

Use [the Railway runbook](docs/deployment/railway.md) and complete [the release checklist](docs/operations/release-checklist.md) before deployment.

## Data and privacy

Guest schedules remain in browser storage. Signed-in accounts store the Google-supplied verified email/name and schedule data in PostgreSQL. Redis holds short-lived rate-limit counters. The UI provides schedule export and account deletion. See the in-app `/privacy` and `/terms` pages.

No TSS password, student session cookie, enrollment action, grade, or financial record belongs in this system. Report suspected exposure using the [incident response runbook](docs/operations/incident-response.md).

## License

No repository license has been selected. Do not infer permission to copy, redistribute, or operate this project. License selection and matching UI/legal language remain owner decisions.
