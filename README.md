# Tracksheet — University Workforce Intelligence Platform

One web application, one login page. After authenticating, the session's role
decides which dashboard renders. API routes are shared across roles; the
response differs only because the backend scopes it.

**Current state: Phase 11 complete — UI/UX polish pass.**
Deploys to **Render** (`starter` plan, **single instance**). See
[DEPLOYMENT.md](DEPLOYMENT.md) for why single-instance is a correctness
requirement and not a cost choice.
All phases 1–9 implemented and gated. See [VERIFICATION-REPORT.md](VERIFICATION-REPORT.md)
for what was audited and [DATABASE-ARCHITECTURE.md](DATABASE-ARCHITECTURE.md) for
the schema and measured query plans. Phases 1–8 implemented, plus a
scale-oriented database architecture and an automatic metric rollup.
See [DATABASE-ARCHITECTURE.md](DATABASE-ARCHITECTURE.md) for the schema audit,
index strategy, aggregation design, and measured query plans.
See [VERIFICATION-REPORT.md](VERIFICATION-REPORT.md) for what was found and how each
finding was proven fixed. Known gaps are listed there too — schedules, breaks,
workload targets, deliverable progress logging, admin write endpoints, and
Excel/PDF export are not built.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router, TypeScript), one deployable |
| API | Route Handlers — real HTTP endpoints, reachable by `curl` |
| DB | PostgreSQL 16 (Docker) |
| ORM | Prisma 7 with the `pg` adapter |
| Auth | Server-side sessions, httpOnly cookie, scrypt password hashing |
| Tests | Vitest driving raw HTTP against a running server |

## Setup

```bash
npm install
npm run db:up        # starts postgres (dev :5433, test :5434)
npm run db:migrate   # applies migrations
npm run db:seed      # seeds 2 universities, 1 admin, 2 managers, 4 instructors
npm run dev
```

The test database runs on tmpfs and is disposable; the dev database persists in
a named volume.

### Seeded accounts

All use password `Password123!`.

| Email | Role | University |
|---|---|---|
| `admin@example.edu` | ADMIN | — (global) |
| `manager.north@example.edu` | MANAGER | Northfield (Asia/Kolkata, Mon–Fri 09:00–18:00) |
| `manager.west@example.edu` | MANAGER | Westbrook (America/New_York, Mon–Sat 08:30–16:30) |
| `inst.north1@example.edu` | INSTRUCTOR | Northfield |
| `inst.north2@example.edu` | INSTRUCTOR | Northfield |
| `inst.west1@example.edu` | INSTRUCTOR | Westbrook |
| `inst.west2@example.edu` | INSTRUCTOR | Westbrook |

The two universities differ in timezone, working days, working hours, and
opening/closing durations. That difference is deliberate — Phase 2's gate needs
to prove two universities compute different windows at the same time.

## Running the gates

```bash
npm test
```

Spins up a throwaway database and a real Next.js server, then makes raw HTTP
requests. No test imports application code, so nothing here can be satisfied by
a frontend-only check.

### Verifying isolation by hand

```bash
# Log in as the Northfield manager and keep the cookie
curl -s -c /tmp/jar -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"manager.north@example.edu","password":"Password123!"}'

# Their own roster — 2 Northfield instructors
curl -s -b /tmp/jar localhost:3000/api/instructors

# Ask for Westbrook explicitly → 403 CROSS_TENANT_DENIED
curl -s -b /tmp/jar "localhost:3000/api/instructors?universityId=<WESTBROOK_ID>"
```

Get `<WESTBROOK_ID>` from `/api/universities` while logged in as admin.

## Architecture rules

These are enforced, not merely documented:

1. **No endpoint implements its own tenant check.** Every tenant-scoped route
   goes through `withAuth` in [route.ts](src/server/http/route.ts) and derives
   its `where` clause from a helper in [scope.ts](src/server/auth/scope.ts).
2. **Role and universityId never come from the client.** The login body accepts
   only email and password; everything else is read from the database per
   request.
3. **Admin scope is a branch, not a null.** `TenantScope` is a tagged union
   (`global` / `university` / `self`), so an admin's global access can never be
   an accidental `WHERE universityId IS NULL`.
4. **Cross-tenant probes 403; out-of-scope records 404.** A manager asking for
   another university gets a loud refusal, but a specific record they shouldn't
   know exists returns "not found".
5. **Database-enforced invariants.** `ADMIN ⟺ universityId IS NULL` is a CHECK
   constraint, and a composite FK makes it impossible for a manager/instructor
   profile to sit in a different university than its own user account.
6. **Calendar math is per-tenant.** [workday.ts](src/server/time/workday.ts)
   derives working days from the university's IANA timezone, never the server's.
7. **Summary tables are populated automatically.** A scheduler recomputes a
   trailing window every hour; the seed runs an initial rollup so a fresh
   environment has working dashboards immediately. See "Metric rollup" below.
8. **One analytics engine.** [engine.ts](src/server/analytics/engine.ts) is the only
   place workload maths happens. Dashboards, reports, and the AI layer all read it,
   so they cannot disagree. Worked time is the union of intervals, never the sum.
9. **"No record" is not "zero hours".** A working day with no activity is reported
   as `missingDataHours`, distinct from `unutilizedHours`.
10. **AI states only what it can show.** Every insight stores the metric snapshot it
   was derived from, and a test asserts every number in its prose appears there.

## Layout

```
prisma/
  schema.prisma            identity, tenancy, university configuration
  migrations/              phase1_core, phase1_invariants (CHECK constraints)
  seed.ts                  two deliberately-different universities
src/server/
  auth/password.ts         scrypt hashing, constant-time verification
  auth/session.ts          server-side sessions; only token hashes are stored
  auth/scope.ts            TenantScope + the only place `where` clauses are built
  http/route.ts            withAuth wrapper — the single authorization chokepoint
  time/workday.ts          tenant-local working-day derivation
  time/schedule-windows.ts opening/closing window derivation
  analytics/engine.ts      THE workload/utilisation engine — single source of truth
  analytics/period.ts      reporting-period resolution, in the tenant's timezone
  activities/logger.ts     activity writes, once-per-day rule, interval validation
  reports/generator.ts     report shaping only; all maths delegated to the engine
  ai/insights.ts           rule-based insights, each traceable to its snapshot
  audit/logger.ts          audit trail, including global admin actions
  universities/config.ts   university configuration loading
src/app/api/               login, logout, me, universities, instructors, activity-types
tests/                     raw-HTTP tenant isolation and config calculation gates
```

## Design

Every page is built from one set of primitives ([ui.tsx](src/app/_components/ui.tsx))
on one set of semantic colour tokens ([globals.css](src/app/globals.css)). See
[DESIGN.md](DESIGN.md) for the palette, type scale, spacing rhythm and component
patterns — **new pages should be built from these**, since hand-rolled styling per
page is how the drift this pass removed started in the first place.

Three things the system enforces that matter beyond appearance:

- **`null` renders as "Not measurable", never as 0.** The distinction between
  "we measured zero" and "there was nothing to measure" is load-bearing in this
  product and survives all the way to the screen.
- **Utilisation and compliance carry a tone**, from bands defined once in
  `ui.tsx`, so a number is readable as healthy or concerning at a glance rather
  than requiring the reader to know the thresholds.
- **Skeletons mirror the layout they replace**, so nothing jumps when data lands.

## Deployment

Target is **Render** — a persistent, always-on Node process, not serverless.
That is what makes the in-process rollup scheduler and the in-memory rate
limiter correct here: the process stays up, so the timer fires and the counters
survive between requests.

- **Plan: `starter` or above.** Render free services sleep after inactivity,
  which would stop the timer and clear the counters on every wake.
- **`numInstances: 1`.** The rollup scheduler is safe under multiple instances
  (a database lease stops double-runs), but the rate limiter is not — two
  instances mean two sets of counters and roughly 2× the intended attempt
  budget. Move the limiter to Redis before scaling out.
- Migrations run via `preDeployCommand`, before the new instance takes traffic.
- Health check at `GET /api/health`.

Full configuration, environment variables, and the post-deploy checklist are in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Provisioning

A university can be created and staffed entirely through the UI:

`/admin/universities/new` → create with working hours, days, timezone,
opening/closing durations and optional holidays → add the primary manager on the
university's detail page → that manager signs in and adds instructors from
`/manager/instructors`.

Accounts are created with an **initial password set by the provisioner**, not an
emailed invite. There is no mail transport in this system, so an invite could
not be delivered; this works with the auth stack that exists. The trade-off is
that the password travels out-of-band, which the UI says plainly rather than
leaving someone to discover.

A manager's new instructors join **their own** university — the tenant comes
from the session, and a `universityId` in the request body is rejected rather
than trusted.

## Security posture

A checklist test enumerates **all 32 API routes** and probes each with three
callers who must be refused — anonymous, a manager from another university, and
a colleague instructor. It fails the build on any route that answers. Current
result: 32 routes, 0 failing.

**Rate limiting** on login, by IP *and* by account. IP alone lets one attacker
behind a NAT lock out an office; account alone lets a distributed attacker
spread across addresses. In-memory and per-process, which is stated plainly in
[rate-limit.ts](src/server/http/rate-limit.ts): behind multiple instances the
effective limit multiplies, and a restart clears counters. Replacing `hit()`
with a Redis-backed version is the upgrade path; call sites do not change.

**Three routes build their own tenant predicate** outside `scope.ts`:
`admin/overview`, `admin/rollup`, `holidays/[holidayId]`. Safe only while they
stay ADMIN-only (global scope, nothing to restrict). A dedicated test asserts
they have not been widened — if one is ever opened to managers it must move
through `scope.ts` first.

**No secret ever leaves the server**: a test asserts no endpoint returns a
password hash, session token, or scrypt-encoded value, and that internal errors
carry no stack traces or SQL.

There is no file-upload surface, so there is nothing to validate there.

## Reports, notifications, audit

**Exports record a `ReportJob`** — who exported what, when, and how many rows.
Generation is inline because current volumes finish in milliseconds; the row is
the handover point, so moving to a worker means marking the job `QUEUED` and
letting the worker fill `resultUrl`, with no change to the caller's contract.

**CSV only.** Native `.xlsx` and PDF are not implemented — both need a document
library, and CSV already opens directly in Excel and satisfies the client's
spreadsheet requirement. Stated here rather than implied.

**Notifications reuse the anomaly and exception detectors** rather than a third
rule set, so a notification and a dashboard insight cannot disagree about what
counts as a problem. Categories: deliverable deadlines, missing/late
opening-closing, unusual workload, and report availability.

Every notification carries a `dedupeKey` with a unique index on
`(userId, dedupeKey)`. The sweep runs on every rollup tick, so without it an
unresolved condition would notify the same person hourly forever. The index is
the real guarantee; the application pre-check just avoids a round-trip, and a
duplicate that slips past a race is absorbed rather than aborting the sweep.

**Audit** is readable per university at `GET /api/universities/:id/audit`
(admin/manager only — an audit trail is inherently about other people, which is
exactly what instructor-scoped endpoints withhold).

## AI insights

Two layers, deliberately separate:

```
analytics (calculated metrics)
   ↓ detectAnomalies()    plain code — decides WHETHER a condition holds
   ↓ narrateCondition()   turns one condition into a sentence
   ↓ stored insight       carrying the condition, its metrics and threshold
```

Conditions: `OVERLOAD`, `UNDERUTILIZATION`, `LEARNING_DROP`, `COMPLIANCE_RISK`,
`DELIVERABLE_RISK`, `NO_DATA_RECORDED`, `INCOMPLETE_DATA`. Thresholds are named
constants in [anomalies.ts](src/server/ai/anomalies.ts) and each insight quotes
the threshold it applied.

**A model never decides whether an anomaly exists.** Asked to find anomalies in
a metric dump, a model will confidently invent them; asked to phrase an
already-detected condition, the worst it can do is word it badly — and the
wording is checkable against the numbers stored beside it.

**The model boundary is structural.** `narrateCondition` takes an
`AnomalyCondition` and nothing else — no database handle, no activity rows. The
requirement "never send raw ActivityLog to the model" is enforced by the input
type, not by convention.

**Gemini Flash writes the prose**, when `GEMINI_API_KEY` is set. Everything
above the narrator is unchanged: the deterministic engine still decides which
conditions exist, and the model only phrases them.

- **Isolated to one file** — [gemini.ts](src/server/ai/gemini.ts) is the only
  module that knows the vendor exists.
- **No names, no activity rows.** The request carries the condition, its
  metrics, and the threshold — exactly the payload already stored for
  traceability. The subject is sent as `{{SUBJECT}}` and the real name is
  substituted locally, because a third party phrasing a sentence about
  utilisation has no need to learn who the person is.
- **Fallback on every failure** — no key, timeout, rate limit, HTTP error,
  malformed or empty reply. The deterministic narrator is not dead code; it is
  the floor the system stands on, and stays fully tested.
- The title stays deterministic so grouping and filtering do not fragment.

Run `GEMINI_API_KEY=... npm run ai:sample` to print five real narrations with
automatic checks for invented numbers and judgemental language.

## Analytics engine

[engine.ts](src/server/analytics/engine.ts) is the only place workload maths
happens. It computes hours per activity type, opening/closing compliance,
unutilized and missing-data hours, utilization, **workload variance** against
effective-dated `WorkloadTarget` rows, **deliverable completion** from dated
logs, and **trends** against the preceding period (`?trend=1`, opt-in because it
doubles the query cost).

Two decisions worth knowing:

- **Trend windows are weekday-aligned.** A span of a week or less shifts back a
  whole week rather than by its own length. Shifting a Mon–Fri window back five
  calendar days lands on Wed–Sun, comparing five working days against three and
  inventing a fall in teaching hours.
- **Deliverable completion is period-scoped** — deliverables with progress
  logged in the window, or falling due in it. Counting every open deliverable
  would let a one-week percentage move whenever unrelated future work was
  assigned.

## Role applications

| Role | Pages |
|---|---|
| Admin | Dashboard · Universities → university detail (managers + instructors) · Instructors → instructor detail (days → activities) · Reports |
| Manager | Dashboard · Instructors · Activities · Deliverables · Reports |
| Instructor | Dashboard (today's schedule, opening/closing, workload, deliverables, personal insights) · My Activities |

The admin drill-down resolves university → manager → instructor → date →
activity, each step backed by a real endpoint.

Scheduling is a management action: a manager plans `ScheduleSlot` rows for an
instructor, and the instructor records what actually happened via activities.
`DAILY_OPENING` / `DAILY_CLOSING` are rejected as slots — they are derived from
the university's configured hours, and making them schedulable would let one
working day carry several of each.

## Data-quality exceptions

`GET /api/universities/:id/exceptions` returns derived data-quality flags:
`MISSING_ACTIVITY`, `OVERLAPPING_ACTIVITY`, `LATE_OPENING`, `MISSED_CLOSING`,
`UNEXPECTED_ABSENCE`, `OUTSIDE_WORKING_HOURS`, `DUPLICATE_LOG`,
`INVALID_DURATION`.

Every flag is **computed on read** from activity, university config, and
approved leave. There is deliberately no `exceptions` table: a stored flag is a
second source of truth that goes stale the moment the activity behind it
changes, and one an operator could edit independently of the data it describes
is worse than no flag at all. Each flag carries the `evidence` it was derived
from.

`MISSING_ACTIVITY` fires only on a genuinely unexplained gap — never on a
non-working day, a holiday, or approved leave. An empty day produces exactly one
flag, not three; it is not also reported as a missed closing.

## Metric rollup

Dashboards read `UniversityDailyMetric` / `InstructorDailyMetric` /
`InstructorWeeklyMetric` rather than aggregating raw activity on every request.
Those tables are kept current by a scheduler started from
[instrumentation.ts](src/instrumentation.ts) when the server boots.

| Setting | Env var | Default |
|---|---|---|
| Tick interval | `ROLLUP_INTERVAL_MINUTES` | `60` |
| Window recomputed each tick | `ROLLUP_WINDOW_DAYS` | `3` (trailing) |
| Disable entirely | `DISABLE_ROLLUP_SCHEDULER` | unset (`1` disables) |

**Why a trailing window rather than "roll up yesterday at midnight":** tenants
span timezones so there is no single midnight, and activity gets logged late.
Recomputing the last few days every tick is idempotent, self-healing after a
missed tick or restart, and correct in every timezone without per-tenant
scheduling.

Concurrency is handled by a lease (the `RUNNING` MetricsJobRun row), claimed
under a transaction-scoped advisory lock. A session-level lock was tried first
and is wrong here — under connection pooling the unlock lands on a different
connection than the lock, so it leaks.

- `POST /api/admin/rollup` — force a recompute now (admin). Still supported; no
  longer the only way the tables get populated.
- `GET /api/admin/rollup` — run history, last success, and staleness in seconds.
- `npm run db:seed` runs an initial rollup, so a fresh database has populated
  dashboards without anyone pressing a button.

The periodic timer is disabled under test (`DISABLE_ROLLUP_SCHEDULER=1`) so it
cannot race the explicit rollups the tests trigger. The function it calls is
covered by the suite through the `MANUAL` and `SEED` paths; the timer wiring was
verified separately against a live server.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm test` | Full gate: isolation, config, activities, analytics, insights |
| `npm run db:up` / `db:down` | Start / stop Postgres |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Reseed |
| `npm run db:perf-seed` | Generate a 100-university / 3.9M-activity perf dataset |
| `npm run db:drift` | Fail if migrations and schema.prisma disagree |
