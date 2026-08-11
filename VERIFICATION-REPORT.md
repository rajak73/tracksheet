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
