# Independent Verification Report

> **Status: all findings below were fixed and re-verified on 2026-08-11.**
> Each fix was confirmed by deliberately re-introducing the defect and watching the
> new tests fail. The original probes were replayed against the fixed code and all
> pass. Test suite: 55 → 88, all raw HTTP. Remaining known gaps are listed in
> "Findings 10–15", which were scoped out rather than fixed — schedules, breaks,
> workload targets, deliverable progress logging, admin write endpoints, and
> Excel/PDF export.

**Date:** 2026-08-11
**Scope:** Everything added after the Phase 1 commit (`95081e0`) — Phases 3–8 as built by another agent.
**Method:** Executed against the running application. No claim below rests on reading a comment, a
docstring, or a README. Every finding marked *proven* was reproduced by making real HTTP requests or
running real database queries, and the observed output is quoted.

---

## Verdict

The **foundations hold**: cross-university isolation was not regressed, the once-per-day rule is
correctly implemented, and the app typechecks and builds. The **layer built on top is not
trustworthy**: instructors can read and write each other's records, the reporting numbers are wrong
by construction, the AI states figures that do not exist, and the database cannot be recreated from
its own migrations.

`npm test` reports **55/55 passing**. That number is misleading, and understanding why is the single
most important thing in this report — see Finding 9.

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Instructor can read/write a colleague's records | Critical | Proven live |
| 2 | 5 tables + 2 enums have no migration | Critical | Proven |
| 3 | Reports double-count overlapping activities (+33%) | Critical | Proven |
| 4 | Report date-range filter silently ignored | Critical | Proven |
| 5 | AI states metrics that do not exist | Critical | Proven |
| 6 | Admin dashboard is entirely hard-coded | High | Proven |
| 7 | Negative-duration activities accepted | High | Proven |
| 8 | Utilization capacity model contradicts spec | High | Code-confirmed |
| 9 | Test suite mostly mocks the database | High | Proven |
| 10 | 12 core models absent | Medium | Proven |
| 11–15 | Audit gaps, missing admin writes, CSV-only, lint | Medium/Low | Proven |

---

## Finding 1 — An instructor can read and write a colleague's records (Critical)

**Root cause.** Two routes call `assertCanAccessUniversity(scope, universityId)` where they needed
instructor-level scoping. That helper delegates to `narrowUniversity`, which compares only the
*university*. An instructor's scope is `{kind:'self', universityId, instructorId}`, so the check
passes for **every instructor in their own university**.

The correct helper — `assertCanReadInstructor` — already exists in `scope.ts` and pins to
`scope.instructorId`. It was simply not used in these two files.

Affected:
- `src/app/api/universities/[id]/activities/route.ts:7`
- `src/app/api/instructors/[id]/deliverables/route.ts:29` and `:59`

**Proof — activity logs.** A manager logged an activity for instructor *north2*; instructor *north1*
then called the university activities endpoint:

```
planted log for north2      : 201
north1 GET /universities/:id/activities -> 200
rows belonging to OTHER instructors: 1

   LEAKED  instructor=Sara Khan <inst.north2@example.edu> type=TEACHING
           remarks="CONFIDENTIAL-COLLEAGUE-NOTE"
```

Name, email, and free-text remarks of another instructor, returned to a peer.

**Proof — deliverables (read *and* write).**

```
manager creates deliverable for north2      -> 201
instructor north1 GET north2's deliverables -> 200   <-- LEAK
   [{"title":"COLLEAGUE-PRIVATE-DELIVERABLE","targetQuantity":10,...}]
instructor north1 POST deliverable onto north2 -> 201  <-- FORGERY
```

An instructor can create records on a colleague's account.

This directly fails the Phase 5 gate: *"Log in as an instructor; confirm no endpoint on their
dashboard returns another instructor's activity logs."*

> Note: the deliverables half of this was invisible until Finding 2 was worked around. On the
> as-shipped database it returns HTTP 500 (missing table) rather than leaking — the bug is masked by
> a second bug, not absent.

---

## Finding 2 — Five tables and two enums have no migration (Critical)

`schema.prisma` declares `Deliverable`, `DeliverableLog`, `AiInsight`, `AuditLog`, `Notification`,
plus enums `InsightSeverity` and `InsightStatus`. No migration creates any of them. They exist in the
local dev database only because `prisma db push` was used.

**Proof — `prisma migrate diff` between the migrations directory and the schema:**

```
[+] Added enums
  - InsightSeverity
  - InsightStatus
[+] Added tables
  - Deliverable
  - DeliverableLog
  - AiInsight
  - AuditLog
  - Notification
```

**Proof — the dev database records only four migrations** while holding fifteen tables:

```
_prisma_migrations: phase1_core, phase1_invariants, phase2_activity_types, phase3_activity_logs
```

**Proof — runtime consequence.** The test harness builds its database from migrations alone, as a
fresh clone or CI would. Hitting the deliverables endpoint there:

```
P2021  The table `public.Deliverable` does not exist in the current database.
   at src/app/api/instructors/[id]/deliverables/route.ts:31
```

Anyone cloning this repo and running `prisma migrate deploy` gets an application whose deliverables,
insights, notifications, and audit endpoints all return 500.

---

## Finding 3 — Reports double-count overlapping activities (Critical)

`src/server/reports/generator.ts` sums each log's duration in a loop. It never calls
`utilization.ts`, which contains a correct interval-union implementation. Its own comment concedes
this: *"In a real implementation we would filter by date and use the `utilization.ts` engine
properly."*

**Proof.** Two overlapping TEACHING blocks were logged (10:00–11:00 and 10:30–11:30 — a 30-minute
overlap), then both engines were asked for the total:

```
TRUE union hours   : 1.5
report productive  : 2
MISMATCH — report inflates by 0.50h (33%)
```

Two consequences:

1. Phase 4's required behaviour ("overlapping activities do not double-count") fails.
2. Phase 6's requirement that *"the same underlying activity data produces identical numbers whether
   queried via the manager dashboard or the reports endpoint"* cannot hold — there are two divergent
   implementations of the same calculation, and they disagree whenever activities overlap.

---

## Finding 4 — The report date range is accepted and ignored (Critical)

`generateWorkloadReport(universityId, startDate?, endDate?)` declares both date parameters and uses
neither. Every report is all-time.

**Proof** — requesting a window in 2030 containing no data:

```
date range 2030-01-01..02 (no data in range) -> 2h
date filter IGNORED — params accepted but unused
```

A "weekly report" is therefore not weekly, which also invalidates every reporting-period feature
described in Phases 6 and 8.

---

## Finding 5 — The AI states metrics that do not exist (Critical)

In `src/server/ai/insights.ts`, a `WORKLOAD_BALANCE` insight is pushed **unconditionally**, outside
any data-dependent branch, with hard-coded figures in both the prose and the stored
`supportingData`.

**Proof.** Generated for a university whose ground-truth activity-log count is zero:

```
type=WORKLOAD_BALANCE severity=MEDIUM period="Current Week"
  recommendation: 2 instructors have recorded 10+ hours of unutilized capacity
                  this week. Manager review of task assignments may be useful.
  supportingData: {"avgUnutilizedHours":10.5,"unutilizedInstructors":2}

GROUND TRUTH: activity logs in this university = 0
```

No instructor recorded anything. The stored "supporting data" is invented, so the audit trail that
was supposed to make every claim traceable instead lends the fabrication credibility.

Also: there is no LLM call and no analytics engine behind this — it counts instructors and logs, and
`period` is the literal string `"Current Week"` rather than a date range.

---

## Finding 6 — The admin dashboard is entirely hard-coded (High)

`src/app/admin/dashboard/page.tsx` contains **zero** `fetch` calls. Every figure is a literal:
Total Universities `2`, Total Instructors `4`, Global Teaching Hours `124.5`, System Alerts `0`, and
a static "No recent activity to display."

This is the explicitly forbidden case: *"Do not create fake dashboards with hard-coded numbers."*
The manager and instructor dashboards do call real APIs; the admin one does not.

---

## Finding 7 — Activity logging accepts corrupt data (High)

No validation that `endTime > startTime`. Probe results:

| Input | Result |
|---|---|
| endTime **before** startTime (negative duration) | `201 Created` |
| Zero-length activity | `201 Created` |
| 48-hour single activity | `201 Created` |
| Activity on a non-working Sunday | `201 Created` |
| Activity at 03:00 local, outside working hours | `201 Created` |
| Unknown activity type | `404` (correct) |

A negative-duration row silently subtracts from every hour total that sums durations — including the
report generator in Finding 3.

---

## Finding 8 — The utilization capacity model contradicts the spec (High)

`calculateWorkdayUtilization` computes capacity as `workingHours − openingDuration − closingDuration`.

The specification says available capacity excludes **holidays, approved leave, closures, and
configured breaks** — not opening/closing, which are recognised productive activities. As written the
model both shrinks the denominator by opening/closing *and* counts those activities as productive in
the numerator.

It also ignores holidays, leave, and breaks entirely — the three things it was actually required to
exclude. `complianceFlags` is initialised and returned empty, annotated *"Mocked for now"*.

Phase 4's required test — *"utilization % changes correctly when leave is added"* — cannot be written,
because no leave model exists (Finding 10).

---

## Finding 9 — The test suite mostly mocks the database (High)

This explains how 55 tests pass over code with five missing tables.

| File | Tests | What it actually exercises |
|---|---:|---|
| `phase1-tenant-isolation.test.ts` | 22 | Real HTTP |
| `phase2-university-config.test.ts` | 22 | Real HTTP |
| `phase3-activity-logging.test.ts` | 5 | Real HTTP |
| `utilization.test.ts` | 3 | Pure functions, no server |
| `reports.test.ts` | 2 | **`vi.mock`s Prisma** |
| `insights.test.ts` | 1 | **`vi.mock`s Prisma** |

Phases 3–8 contribute 11 tests; Phases 1–2 contribute 44. The mocked tests assert that the code calls
the functions it calls — `insights.test.ts` asserts the fabricated insight from Finding 5 is produced,
enshrining the bug as expected behaviour. Because no test touches deliverables, insights,
notifications, or audit over HTTP, the missing tables were never noticed.

`reports.test.ts` feeds the generator two *non-overlapping* intervals, which is precisely the case
that hides Finding 3.

---

## Finding 10 — Twelve specified models are absent (Medium)

`Schedule`, `ScheduleSlot`, `LeaveRequest`, `Break`, `WorkloadTarget`, `ReportingPeriod`,
`AvailabilitySlot`, `Department`, `Course`, `AcademicTerm`, `LearningActivity`, `WeeklyReport`.

Phase 3 was specified as "schedules and activity tracking"; only activity tracking exists. Without
`LeaveRequest` and `Break` the utilization engine cannot exclude what the spec requires, and the
`UNUTILIZED / MISSING_DATA / ABSENCE / BREAK / LEAVE` distinction is unrepresentable — only
`UNUTILIZED` exists, as an activity type.

---

## Findings 11–15 (Medium / Low)

11. **Audit logging covers one action.** `logAudit` has exactly one call site (AI insight
    generation). The spec required schedule edits, workload-target changes, and deliverable updates.
12. **No admin write endpoints.** `/api/universities` is GET-only — an admin cannot create a
    university or assign a manager through the API.
13. **No deliverable-progress endpoint.** `DeliverableLog` exists as a model with no route, so
    Phase 4's "a deliverable logged across three dates sums correctly" is untestable.
14. **CSV export only.** No Excel or PDF.
15. **12 ESLint errors** in application code (mostly `no-explicit-any`, one `prefer-const`).
    TypeScript is clean and `npm run build` succeeds.

---

## What was verified as working

Stated plainly, because it matters for deciding what to keep:

- **Cross-university isolation was not regressed.** All nine manager→other-university probes against
  new endpoints returned 403/404: activities, analytics, reports, insights (GET and POST), and
  instructor-scoped activities and deliverables.
- **The once-per-day rule is correct, including across timezones.** A DAILY_OPENING at 23:00 UTC —
  which is the *next* calendar day in Asia/Kolkata — was correctly accepted as a separate working
  day, while a second opening on the same local day was rejected with `409`. The partial unique index
  `ActivityLog_once_per_day_idx` backs it at the database level.
- **`logActivity` derives `workDate` from the university's own timezone**, as designed in Phase 2.
- **Role guards on the page tree are server-side.** All three layouts call `getPrincipal()` and
  redirect on role mismatch.
- **`tsc --noEmit` is clean and the production build succeeds.**

---

## Recommended order of work

1. **Finding 1** — swap `assertCanAccessUniversity` for `assertCanReadInstructor` in the two routes,
   and scope `/universities/[id]/activities` to `scope.instructorId` when `scope.kind === "self"`.
   Add HTTP tests that fail without the fix.
2. **Finding 2** — generate the missing migration and verify with `migrate diff` that the migrations
   directory and schema agree. Add that check to CI.
3. **Findings 3, 4, 8** — delete the duplicate math in `generator.ts`; make `utilization.ts` the only
   engine, honour the date range, and fix the capacity definition.
4. **Finding 7** — reject `endTime <= startTime` at the API boundary and add a CHECK constraint.
5. **Finding 5** — remove the fabricated insight; derive every figure, or emit nothing.
6. **Finding 9** — convert the mocked tests to HTTP tests. A useful discipline: after fixing each bug
   above, deliberately re-break it and confirm the new test fails.
7. **Finding 6** — wire the admin dashboard to real endpoints (which requires Finding 12).

A note on sequencing: Findings 1 and 2 interact. Fixing the migration without fixing the
authorization bug turns a masked leak into a live one, so do them in the order above.


---

# Addendum — Role Architecture Verification (2026-08-11)

Verified against the running application: one shared login, role-based routing,
page guards, and the backend authorization matrix.

## What passed as specified

**One login, three applications.** A single `/login` page; all three roles POST
to the same `/api/auth/login`; the response's role drives the redirect to
`/admin/dashboard`, `/manager/dashboard`, or `/instructor/dashboard`. `/`
redirects to `/login`. The three dashboards are genuinely separate route trees
with separate components — not one dashboard with hidden menu items.

**Page-level guards form a clean diagonal.** Each role reaches only its own
tree; every other combination is redirected to `/login`:

```
              /admin  /manager  /instructor
ADMIN            200      307        307
MANAGER          307      200        307
INSTRUCTOR       307      307        200
anonymous        307      307        307
```

**The backend enforces the same boundaries independently**, verified endpoint by
endpoint: ADMIN global, MANAGER confined to one university (403 on another's),
INSTRUCTOR confined to themselves (404 on a colleague), anonymous 401 everywhere.
Admin-only writes (config PATCH, holidays) reject managers and instructors.

## Defects found and fixed

**1. "Sign Out" did not sign the user out (security).** It was
`<a href="/login">` — a navigation that left the session cookie fully valid.
Proven:

```
/api/auth/me AFTER "signing out"       -> 200  <-- SESSION STILL VALID
/manager/dashboard AFTER "signing out" -> 200  <-- STILL LOGGED IN
```

On a shared machine the next person could press Back and resume the session.
Replaced with a button that POSTs to `/api/auth/logout`, which revokes the
session server-side.

> The first regression test for this was itself inadequate — it passed even with
> server-side revocation removed, because it only proved the client's cookie had
> been cleared. It now captures the cookie before logout and replays it, which
> is what an attacker holding a stolen cookie would do. That version does fail
> when revocation is removed.

**2. Eight dead navigation links.** Admin (Universities, Managers, Reports),
Manager (Instructors, Schedules, Analytics), and Instructor (Schedule,
Deliverables) navigation all pointed at `href="#"` — the explicitly forbidden
"buttons that do nothing". Every nav entry now resolves to a real page, verified
by a test that loads each one.

**3. Admin had no teaching/learning split.** The overview reported a single
`productiveHours` total, so "global teaching hours" and "global learning hours"
were not answerable. Now returned per activity type and shown separately.

**4. Instructors could not submit requests.** Leave creation was
ADMIN/MANAGER-only, contradicting "Instructor can submit requests". An
instructor may now submit for themselves, forced to `PENDING`; only a manager or
admin can approve. Self-approval would otherwise let an instructor shrink their
own utilisation denominator.

**5. Instructors had no personal AI insights.** University insights are a
management artifact and may reference colleagues, so they remain 403. A new
self-scoped `/api/instructors/:id/insights` derives insights from that
instructor's own metrics using the same rule set, so a personal observation can
never contradict a university one.

**6. Instructor dashboard had no "today".** It showed weekly figures only.
Now shows today's productive, capacity, unutilised, and opening/closing status.

## Still not built

Reported rather than silently skipped:

- **Schedules** (`Schedule`/`ScheduleSlot`). "Today's schedule" and "manage
  instructor schedules" cannot be built without them. The instructor dashboard
  shows recorded activity, not a planned schedule.
- **Admin CRUD.** No endpoint creates universities, managers, or instructors —
  provisioning is seed-only. `/admin/universities` is read-only and says so.
- **Full drill-down** (Admin → University → Manager → Instructor → Date →
  Activity). Admin reports drill to university and instructor; the manager and
  date/activity levels are not linked.
- **Deliverable progress.** `DeliverableLog` has a model but no endpoint, so
  deliverables cannot be updated toward their target.
- **Workload targets**, **activity-type management**, **AI configuration**, and
  **platform settings** — no models or endpoints.
- **Excel/PDF export.** CSV only.
- **Approval workflow** beyond leave status.

---

# Addendum — Reconciliation Check (DB architecture doc vs schema)

Reporting only; no schema changes made in this step.

## Premise correction: the opening/closing tables never existed

The request states that "Phase 1 already implemented daily opening/closing
tracking as `daily_opening_logs` and `daily_closing_logs`". That is not the case
in this repository, and the belief matters because it changes what "resolve the
duplicate" would mean.

Every `CREATE TABLE` across all 11 migrations:

| Migration | Tables created |
|---|---|
| phase1_core | User, University, UniversityWorkingHours, UniversityHoliday, Manager, Instructor, Session |
| phase1_invariants | — (CHECK constraints only) |
| phase2_activity_types | ActivityType |
| phase3_activity_logs | ActivityLog |
| phase4_deliverables… | Deliverable, DeliverableLog, AiInsight, AuditLog, Notification |
| phase4_leave_and_breaks | LeaveRequest |
| phase8_auditable_global_actions | — |
| phase4_activity_interval_check | — |
| phase10_scale_architecture | UniversitySettings, Department, Program, AcademicTerm, Course, CourseAssignment, Schedule, ScheduleSlot, BreakPolicy, WorkloadTarget, ReportingPeriod, InstructorDailyMetric, InstructorWeeklyMetric, UniversityDailyMetric, ReportJob |
| phase10_deliverable_status_indexes | — |

Phase 1 created identity and tenancy only. Opening/closing arrived in Phase 3 as
**activity types**, not tables. A repo-wide grep for `daily_opening`,
`daily_closing`, `daily_workday` returns only the string constants
`"DAILY_OPENING"` / `"DAILY_CLOSING"` — rows in `ActivityType`.

So there is **one** shape, not two, and no duplicate system to resolve.

The once-per-day rule is enforced by a partial unique index:

```sql
CREATE UNIQUE INDEX "ActivityLog_once_per_day_idx"
  ON "ActivityLog" ("instructorId", "workDate", "activityTypeId")
  WHERE ("isOncePerDay" = true);
```

This is the generalised option §50 explicitly permits. It is verified by test,
including across a UTC/tenant-local boundary: an opening at 23:00 UTC — the next
calendar day in Asia/Kolkata — is correctly accepted as a separate working day,
while a second opening on the same local day is rejected with 409.

## Tenant scope compliance

No route reads `principal.universityId` to build a query. The only reads are in
`scope.ts` (where the scope is derived) and `/api/auth/me` (echoing the session
back to the client). No route performs its own `principal.role` authorization —
role gating is `withAuth({roles})` throughout.

Five routes do not call a scope helper. Each was checked individually:

| Route | Predicate | Assessment |
|---|---|---|
| `activity-types` | none | `ActivityType` has no `universityId` — a global table. Correct. |
| `auth/login` | none | Pre-authentication. Correct. |
| `auth/logout`, `auth/me` | `principal.sessionId` / `.userId` | Self-only by construction. Correct. |
| `notifications` | `userId: principal.userId` | User-owned, not tenant-scoped. Session-derived, never client-supplied. Correct, but it is a hand-built predicate — there is no scope helper for user-owned rows. |
| `admin/overview`, `admin/rollup`, `holidays/[holidayId]` | own `where` clauses | ADMIN-only (global scope), so there is no tenant restriction to apply. Safe, but these are the three places that build a tenant predicate outside `scope.ts`. |

All three route-level callers of `computeAnalytics` assert scope first. The
service-layer callers (`ai/insights.ts`, `reports/generator.ts`, `rollup.ts`)
receive an already-authorised `universityId`; the engine trusts its argument by
design and is never reachable from a request without passing a route first.

## Summary tables

All three exist. Population status on a freshly seeded database:

| Table | Rows | Written by |
|---|---:|---|
| `InstructorDailyMetric` | 0 | `rollupUniversityDaily()` |
| `UniversityDailyMetric` | 0 | `rollupUniversityDaily()` |
| `InstructorWeeklyMetric` | 0 | **nothing — defined but never written** |
| `ReportJob` | 0 | nothing — schema and contract only |

**Trigger: manual only.** `POST /api/admin/rollup` (admin-gated). There is no job
queue, no cron, no scheduler, and no on-write trigger. BullMQ appears only in
comments describing where a worker would attach.

### Consequence worth acting on

The admin dashboard now reads `UniversityDailyMetric`. On a freshly seeded
database that table is empty, so **the admin dashboard shows zeros until someone
manually calls the rollup endpoint** — verified directly against the seeded
database. Before Phase 10 it computed live and was always current. This is a
real regression in default behaviour introduced by the aggregation change, and
it is the strongest argument for wiring an actual scheduler next.

## Migration safety

No table was dropped or restructured destructively. Two statements in
`phase10_scale_architecture` warrant naming:

1. `ALTER TABLE "Deliverable" DROP COLUMN "status"` — preceded by a temporary
   column and an `UPDATE` mapping every old `ActivityStatus` value into the new
   `DeliverableStatus`. Values are carried across, not discarded.
2. `DELETE FROM "DeliverableLog" WHERE "universityId" IS NULL OR "instructorId"
   IS NULL` — removes rows the backfill could not resolve. Such rows require a
   `DeliverableLog` with no parent `Deliverable`, which the FK added in phase4
   (`ON DELETE CASCADE`) makes impossible. It is a no-op safety net, but it is a
   real `DELETE` and is named here rather than buried.

The generator's own output was corrected in two places where it would have lost
data: `DeliverableLog.date` was being `DROP`ped and re-added instead of renamed,
and `Deliverable.status` was being dropped without migrating its values.

The database was **not** reset. The migration was applied to the populated dev
database and succeeded, backfilling `UNIV001`/`UNIV002`. It was separately timed
against the 3.9M-row perf database at 18.7 s.

`npm run db:seed` produces exactly what the README documents: 7 accounts
(1 admin, 2 managers, 4 instructors), 2 universities with differing timezones and
working hours, 11 activity types, password `Password123!`.


---

# Addendum — Phases 4.5 through 9 complete (2026-08-12)

All remaining phases implemented and gated. Tests **196 → 208** across 15 files,
all raw HTTP against a real server.

## Phase 9 isolation checklist

The gate required an endpoint-by-endpoint checklist rather than a pass/fail
summary. All **32 routes** are enumerated and probed with three callers who must
be refused — anonymous, a manager from another university, and a colleague
instructor:

```
32 routes checked · 0 failing
```

University-scoped routes refuse anonymous with 401 and a foreign manager with
403. Instructor-scoped routes refuse a foreign manager and a colleague with 404
rather than 403, so neither can confirm that an id exists. Admin routes refuse
managers and instructors alike with 403.

The three routes that build their own tenant predicate outside `scope.ts`
(`admin/overview`, `admin/rollup`, `holidays/[holidayId]`) have a dedicated test
asserting they remain ADMIN-only. They are safe only while global-scope; if one
is ever opened to managers it must move through `scope.ts` first.

## What each phase added

| Phase | Delivered |
|---|---|
| 4.5 | Eight derived data-quality exception types, computed on read with no exceptions table |
| 5 | Admin drill-down (university → manager → instructor → date → activity), manager deliverables, instructor today's schedule, schedule API |
| 6 | Workload variance, deliverable completion, trends; deliverable-progress and workload-target endpoints |
| 6.5 | Automatic rollup scheduler with database lease; weekly metrics written |
| 7 | Anomaly detection split from narration; structural model boundary |
| 8 | ReportJob records on export, four notification categories with dedupe, audit read endpoint |
| 9 | Rate limiting on login, 32-route isolation checklist, input-validation and secret-exposure tests |

## Bugs the negative controls found

Each phase was verified by deliberately re-breaking it. Four of those runs found
defects that the passing tests had missed:

1. **Session-level advisory lock leaked under connection pooling** (6.5). The
   lock was acquired on one pooled connection and released on another, so the
   release silently no-opped. Five rollup calls produced two run rows. Replaced
   with a lease claimed under a transaction-scoped lock.
2. **`InstructorDailyMetric` was written but never read or asserted** (Phase 10
   work, found during 6.5). Corrupting it was invisible. Now exposed and checked
   day-by-day against the engine.
3. **A duplicate notification aborted the rest of the sweep** (8). Found while
   chasing why removing the application-level dedupe check changed nothing — the
   unique index was the real guarantee, and the resulting constraint violation
   propagated out of the sweep.
4. **The no-data guard was untested** (7). Removing it let `UNDERUTILIZATION` be
   asserted against zero records, and the Phase 7 file passed anyway because it
   only checked which condition was present, never which were absent.

Two design errors were also corrected because a test forced the question:
trend windows are now weekday-aligned (comparing Mon–Fri against the previous
five calendar days lands on Wed–Sun, inventing a fall in teaching hours), and
deliverable completion is scoped to the reporting period rather than counting
every open deliverable.

## Known limitations

- **Rate limiting is in-memory and per-process.** Behind multiple instances the
  effective limit multiplies; a restart clears counters. Redis is the upgrade
  path and `hit()` is the only thing that changes.
- **The rollup scheduler is an in-process timer**, so it will not fire on a
  serverless deployment. That is the point at which a queue becomes necessary.
- **CSV is the only export format.** Native `.xlsx` and PDF need a document
  library.
- **No LLM is wired.** The narration layer is deterministic; the boundary is
  built so a model call replaces one function body.
- **Academic tables** (`Department`, `Program`, `Course`, `AcademicTerm`,
  `CourseAssignment`) have schema, indexes and constraints but no API or UI.
- **Admin provisioning** — creating universities, managers, or instructors — is
  still seed-only.
