# UCSD WebReg Replacement — Design

Status: APPROVED (all sections reviewed 2026-07-21). Next step: implementation plan.

Decisions so far: public site for all students · near-live seats (~5–15 min scrape) ·
Google OAuth · modern UI / classic workflow · TS everywhere (Next.js App Router + Prisma/Postgres) ·
modular monolith + background worker · v1 = core only (search, planner, calendar, conflicts, saved schedules).

---

## Section 1 — System overview + module layout (APPROVED)

```
ucsd-webreg/
├── apps/
│   ├── web/                  # Next.js App Router
│   │   ├── app/              # routes: /, /search, /planner, /api/*
│   │   └── ...
│   └── worker/               # background import/sync process
├── packages/
│   ├── db/                   # Prisma schema + client (shared)
│   ├── catalog/              # course/section domain: types, normalize, queries
│   ├── planner/              # pure logic: conflict detect, schedule ops, finals
│   ├── search/               # search index build + query
│   └── config/               # shared config, term definitions
├── package.json              # npm workspaces (monorepo, no turborepo yet)
└── docker-compose.yml        # local Postgres
```

Rules:
- `planner` + `search` = pure TS, zero I/O — testable, browser-runnable, extractable.
- `catalog` owns normalization: raw scraped HTML → canonical models. Only worker writes; web reads.
- `apps/web/app/api/*` = thin HTTP layer over packages. Splitting later = lift worker + API
  routes into own services; packages already shared.
- Worker = separate entrypoint/process (own npm script, own container in prod), same repo,
  same Prisma client.

Data flow:

```
SoC (public HTML) → worker (fetch → parse → normalize → diff) → Postgres
Postgres → web API → client
Postgres → term catalog JSON snapshot (regenerated on change) → client-side search/planner
```

Client downloads whole-term compact catalog JSON (~1–3 MB gzipped) cached w/ ETag →
instant client-side search + drag-drop, no roundtrips. Seat counts ride the same snapshot
(regenerated every scrape cycle) plus a small `/api/seats/[termId]?sections=` endpoint for
on-demand freshness.

---

## Section 2 — Data model (Prisma) (APPROVED)

Pre-implementation verification done (via SheepTester/uxdy `scheduleofclasses/scrape.ts`,
a battle-tested parser of the exact SoC HTML):

- **A section CAN have multiple weekly meetings** (e.g. SP23 BENG 100 has extra lecture
  rows rendered as `.nonenrtxt`). → separate `Meeting` table, not days/times on Section.
- **Waitlist count IS publicly visible when a section is full** — seats cell shows
  `FULL Waitlist(17)`. (Earlier research claimed it was auth-only; wrong.) → `waitlisted`
  is populated whenever the section is full, null otherwise.
- Units appear as a range `{from, to, inc}`, `inc` can be 0.5 → three numeric fields.
- Rows without a 6-digit code are non-enrollable meetings shared by the family; only rows
  with codes are enrollable. "Unlim" capacity exists (store null = unlimited).

```prisma
enum MeetingType {
  LE  DI  LA  SE  ST  IN  IT  FW  TU  PR  RE  OT   // weekly meeting kinds
}

enum ExamType {
  FI  MI                                            // final, midterm
}

model Term {
  id        String   @id      // "FA26"
  name      String            // "Fall Quarter 2026"
  active    Boolean           // currently scraped?
  startsAt  DateTime          // instruction start — calendar generation
  endsAt    DateTime          // instruction end
  courses   Course[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Course {
  id          String  @id     // "FA26:CSE:110"
  termId      String
  subject     String          // "CSE"
  number      String          // "110" (string: "8A", "199H")
  title       String
  unitsFrom   Float           // 4, or range start
  unitsTo     Float           // = unitsFrom when fixed
  unitsInc    Float           // step (can be 0.5)
  restriction String[]        // restriction codes (D, ER, ...)
  note        String?         // red course-level note from SoC
  description String?         // optional enrich from catalog.ucsd.edu
  sections    Section[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([termId, subject])
}

// One row per section code (A00, A01, 001...). Enrollable iff registrationNumber set.
model Section {
  id                 String  @id   // "FA26:CSE:110:A01"
  courseId           String
  sectionCode        String        // "A00", "A01", "001"
  familyCode         String        // "A" — lecture/discussion grouping
  registrationNumber Int?          // 6-digit number students search by; null = not enrollable
  instructor         String?       // null = Staff/TBA
  capacity           Int?          // null = unlimited ("Unlim")
  available          Int?
  waitlisted         Int?          // populated when FULL — public after all
  isCancelled        Boolean @default(false)
  note               String?       // black section-level note
  meetings           Meeting[]
  exams              Exam[]
  seatSnapshots      SeatSnapshot[]
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@unique([courseId, sectionCode])
  @@index([registrationNumber])
}

model Meeting {                     // weekly recurring meeting
  id        String      @id @default(cuid())
  sectionId String
  type      MeetingType
  days      String?               // "MWF" (null = TBA)
  startMin  Int?                  // minutes from midnight
  endMin    Int?
  building  String?
  room      String?
}

model Exam {                        // FI/MI: date-specific
  id        String   @id @default(cuid())
  sectionId String
  type      ExamType
  date      DateTime
  startMin  Int
  endMin    Int
  building  String?               // SoC does expose exam locations
  room      String?
}

model SeatSnapshot {                // append-only seat history
  id         BigInt   @id @default(autoincrement())
  sectionId  String
  at         DateTime
  available  Int?
  waitlisted Int?
  @@index([sectionId, at])
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique      // from Google OAuth
  name      String?
  schedules Schedule[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Schedule {
  id        String   @id @default(cuid())
  userId    String
  termId    String
  name      String                // "My Schedule", "Backup"
  items     ScheduleItem[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, termId, name])
}

model ScheduleItem {
  id         String @id @default(cuid())
  scheduleId String
  sectionId  String
  status     String               // "planned" (only v1 value; room for more later)
  @@unique([scheduleId, sectionId])
}
```

Key decisions:
- Times = minutes-from-midnight ints → conflict check is integer overlap, no timezone pain.
- `Meeting` child table (verified necessity above); `Exam` separate because dated.
- `familyCode` (renamed from parentCode) groups lecture + its discussions; planner enforces
  "1 enrollable section per family + its shared meetings."
- `registrationNumber` explicit + indexed — students search by it.
- ScheduleItem stores only sectionId — schedule renders live from catalog; cancelled/changed
  sections get flagged at render time.
- SeatSnapshot append-only — powers a seat-trend feature later with no schema change.
- Worker diffs + upserts; sections missing from a fresh scrape are marked cancelled,
  never hard-deleted mid-term.
- Catalog JSON snapshot carries `{ version: <monotonic int>, generatedAt }` — clients
  cheaply detect updates via version compare / ETag.
- Deferred (noted, not v1): split `catalog` package into parser / normalize / repository
  submodules as it grows.

---

## Section 3 — Worker / data pipeline (APPROVED)

Source: public SoC — `act.ucsd.edu/scheduleOfClasses/scheduleOfClassesStudentResult.htm`
(GET, query params: `selectedTerm`, `tabNum=tabs-dept`, repeated `selectedDepartments`,
`page`). Department list: `scheduleOfClasses/department-list.json?selectedTerm=<T>`.

**Session quirk (verified from uxdy):** requests 503 unless `jlinksessionidx` /
`jlinkauthserver` cookies are set. Worker bootstraps a session by hitting the SoC form
page first, persists the cookie jar, re-bootstraps on 503. Also: server can be slow —
generous timeouts, retry w/ backoff.

Two loops, one worker process:

1. **Full sync** (every 6h + on-demand CLI): all departments, all pages → parse → normalize
   → diff → upsert courses/sections/meetings/exams. Missing sections → `isCancelled`,
   never deleted. Unknown meeting codes → `OT` + warn log.
2. **Seat refresh** (every 10 min during enrollment windows, 30 min otherwise): same
   pages, but only update `capacity/available/waitlisted` + append `SeatSnapshot` rows
   (write snapshot only when values changed — keeps table small).

Politeness: ≤4 concurrent requests, ~200ms spacing, identifying User-Agent w/ contact
email. Full term ≈ 60–80 pages/department-batch → a full sync is a few thousand requests;
seat refresh reuses the same crawl (SoC has no lighter endpoint), hence 10-min floor.

Pipeline stages (all in `packages/catalog`, worker just orchestrates):

```
fetch (cookie jar, retries) → parse (HTML → ScrapedCourse rows, port of uxdy logic)
→ normalize (canonical models, family grouping, enum mapping)
→ diff+upsert (Prisma transaction per department)
→ snapshot (regenerate term catalog JSON, bump version, write to a Postgres
   or object storage; web serves it with ETag)
```

Failure handling:
- Parser is strict (throw on unknown row shape) but failures quarantine the *department*,
  not the run — log, skip, alert; other departments still update.
- `ImportRun` log table: startedAt, finishedAt, termId, ok/failed departments, error text.
  Powers a `/api/health` freshness endpoint ("data as of X").
- If SoC HTML changes shape post-TSS: parser fails loudly, last-good data + snapshot stay
  served, UI shows "data as of <timestamp>" banner when stale > 24h.

Term lifecycle: new terms appear in SoC term dropdown → worker CLI `add-term FA26` seeds
Term row (dates entered manually from academic calendar); `active` terms scraped, old
terms frozen (kept for history).

Deferred (not v1): catalog.ucsd.edu description enrichment; TSS adapter when SoC dies —
isolated behind `catalog`'s fetch/parse stages, rest of pipeline unchanged.

---

## Section 4 — API surface (APPROVED)

All under `apps/web/app/api/`. JSON. Zod-validated input at every route (system boundary).
Public reads need no auth; schedule writes need session.

**Catalog (public, heavily cached):**
- `GET /api/terms` → active + recent terms
- `GET /api/catalog/[termId]` → full-term catalog JSON snapshot (courses + sections +
  meetings + exams + seats). Served with `ETag: <version>`; 304 when unchanged.
  This is THE data feed — client search/planner runs on it locally.
- `GET /api/seats/[termId]?sections=059266,059267` → fresh seat rows for visible sections
  (cheap poll while user stares at a course)
- `GET /api/health` → last ImportRun per term, data freshness

**Auth (NextAuth v5 / Auth.js, Google provider):**
- `/api/auth/*` — standard NextAuth routes. JWT session strategy (no session table).
  v1 restricts nothing by domain — any Google account works (non-UCSD folks get an
  empty planner, harmless); revisit if abuse.

**Schedules (session required, owner-only):**
- `GET    /api/schedules?term=FA26` → user's schedules + items
- `POST   /api/schedules` `{termId, name}` → create (limit: 20/term/user)
- `PATCH  /api/schedules/[id]` `{name}` → rename
- `DELETE /api/schedules/[id]`
- `POST   /api/schedules/[id]/copy` `{name}` → old WebReg "copy schedule"
- `PUT    /api/schedules/[id]/items` `{sectionIds: string[]}` → replace-all items
  (client is source of truth during drag-drop editing; one PUT on settle, debounced.
  Simpler + more robust than per-item add/remove deltas; payloads are tiny.)

No versioned `/v1` prefix yet — single first-party client; add on first external consumer.
Rate limiting: none v1 beyond platform defaults; catalog snapshot is CDN-cacheable so
hot path barely touches origin.

Conflict-detection etc. is NOT an API — pure `packages/planner` functions running
client-side on catalog data. Server never computes conflicts.

---

## Section 5 — Frontend + planner logic (APPROVED)

**Layout (classic WebReg workflow, modern skin):** one main planner page, matching the
old mental model:

```
┌─ term switcher ─ schedule switcher [My Schedule ▾] [+ new] [copy] [rename] ─ auth ─┐
├─ search bar (always visible, autofocus, autocomplete subjects/courses/#) ──────────┤
├──────────────┬─────────────────────────────────────────────────────────────────────┤
│ search       │  tabs: [ List | Calendar | Finals ]                                 │
│ results      │                                                                     │
│ (course      │  List:     dense table — old WebReg columns                         │
│  accordions, │  Calendar: Mon–Sun weekly grid, 30-min rows, colored blocks,        │
│  sections    │            conflicts red-outlined                                   │
│  w/ seats,   │  Finals:   exam-date grid, conflicts red-outlined                   │
│  Plan button)│                                                                     │
└──────────────┴─────────────────────────────────────────────────────────────────────┘
```

- **Search** (`packages/search`): client-side over catalog snapshot. Prebuilt inverted
  index on load (~50ms for a term). Matches subject ("CSE"), course ("CSE 110", "cse110"),
  title words, instructor, 6-digit registration number. Instant, zero network.
- **Add flow:** result accordion expands course → section family rows (seats, waitlist,
  instructor) → "Plan" adds family selection (lecture + chosen discussion) to active
  schedule. Confirm dialog only when choice needed (multiple discussions / units / TBA).
- **Drag-drop (calendar view):** dragging a planned discussion block shows ghost slots of
  sibling discussions in the same family; drop swaps sections. Drag-out removes. This is
  the old "compare classes" UX upgraded. Library: `@dnd-kit/core`.
- **Conflict detection** (`packages/planner`, pure functions):
  `findConflicts(items, catalog) → Conflict[]` — pairwise integer-overlap on meetings
  (same day + startMin/endMin overlap) and on exam dates. O(n²), n < 30, trivial.
  Rendered as red outlines + banner listing pairs (old WebReg style). Non-blocking —
  warn, never prevent (planning tool, not registrar).
- **State:** Zustand store — catalog (readonly), active schedule (optimistic edits,
  debounced PUT), UI state. Logged-out: schedules in localStorage w/ same shape; on
  login, offer one-time import into account.
- **Rendering:** planner page is client component (interactivity); shell/landing SSR.
  Next.js App Router, Tailwind. Design system per frontend-design skill at
  implementation time — custom palette (no default Tailwind blues), display+sans font
  pair, layered shadows. Mobile: List view first-class, Calendar horizontally scrollable.

**Section state legend (from catalog data):** Open / Full (waitlist N) / Unlimited /
Cancelled — colored chips in list + calendar, matching old status column semantics.

---

## Section 6 — Auth, security, ops (APPROVED)

- NextAuth v5 JWT sessions; Google OAuth only. No passwords, no PII beyond email+name.
- Schedule routes: ownership check on every mutation (schedule.userId === session.uid).
- Zod at all boundaries (API input, scraped-data normalize, env vars via typed config).
- Secrets: `.env` (never committed); prod via platform env vars.
- No CSRF exposure beyond NextAuth defaults (JSON APIs, SameSite cookies).
- Deploy: Vercel (web) is tempting but worker needs a long-lived process → simplest:
  single VPS or Railway/Fly — web container + worker container + managed Postgres.
  docker-compose mirrors this locally. Decision deferred to implementation; architecture
  supports any.
- Monitoring v1: `/api/health` + uptime ping; structured logs (pino).

---

## Section 7 — Testing (APPROVED)

- **Parser:** golden-file tests — real SoC HTML pages (multi-meeting BENG 100-style case,
  cancelled, Unlim, FULL(N), TBA, summer date ranges) checked into fixtures; parse →
  snapshot compare. This is the highest-risk code; test hardest.
- **Planner/search packages:** plain Vitest unit tests — pure functions, easy, thorough
  (conflict edge cases: exact-adjacent times, cross-family, exams same day, TBA).
- **API routes:** integration tests against test Postgres (docker) — auth, ownership,
  item replace, limits.
- **E2E (thin):** Playwright — one happy path: search → plan → see calendar → conflict
  appears → save → reload persists.
- CI: lint + typecheck + unit on every push; integration + E2E on main.

---

## v1 cut line (explicit)

IN: search, plan, multi-schedule, calendar/list/finals views, conflicts, seats w/
waitlist-when-full, Google login, localStorage guest mode.
OUT (later): enrollment helper, prof ratings, seat-trend UI (data accrues meanwhile),
degree audit, TSS adapter, mobile app, email/notify on seat open.

---

## Resolved questions (2026-07-21)

1. Deploy: **Railway** (web container + worker container + managed Postgres).
2. Domain: **non-UCSD-trademarked name** + prominent "not affiliated with UC San Diego"
   disclaimer in footer + landing. Name TBD at launch; nothing blocks on it.
3. Guest→login: **prompt on first login** to import localStorage schedules.
4. Term dates: **manual entry** via worker CLI.
5. Old-WebReg capture: **immediate**. Public assets archived in `archive/reference/`:
   - `webreg2-demo-2015-ucsd-registrar.pdf` — official 22-page annotated UI walkthrough
   - `webreg-main.js` — actual old WebReg client JS (SheepTester gist mirror)
   - `uxdy-scheduleofclasses-scrape.ts` — battle-tested SoC parser reference
   SSO-gated captures (require the user's login): see `archive/CAPTURE-CHECKLIST.md`.
