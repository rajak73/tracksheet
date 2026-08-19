# NIAT Verification Report

**Verified against the codebase as of commit `85c07ec` (2026-08-14).**

This document records what was actually executed and observed. Every claim below
is traceable to source code, a real HTTP response, a real database query, or a
real test run. Items that were not verified are listed as not verified rather
than assumed to pass — §13 and §14 are as load-bearing as §1.

**Method.** Eleven subsystems were verified independently and in parallel, each
re-deriving its evidence from source rather than inheriting earlier claims.
Where an earlier claim turned out to be wrong, the correction is recorded (see
§4, which corrects a previously over-broad claim about the capacity identity).

---

## 1. Current status

| Area | Status |
|---|---|
| Multi-tenancy / authorization | **Verified** |
| Activity integrity (overlap, concurrency, once-per-day, timezone) | **Verified** |
| Deliverables lifecycle | **Verified**, with one defect (§5) |
| Schedule | **Partially verified** — works, but several validation gaps and one 500 (§6) |
| Analytics engine | **Verified with corrections** — the headline identity is conditional, not universal (§4) |
| AI narration + validation | **Verified** |
| Pagination | **Verified** — surface is asymmetric across endpoints (§8) |
| Admin overview performance | **Verified by code structure**; query counts not re-measured this pass (§9) |
| Security | **Verified** |
| CSV export | **Verified** |
| Browser / responsive | **Partially verified** (§12) |
| Load/scale beyond the tested datasets | **Not verified** (§13) |

**Production readiness: see §16.** It is not a blanket "ready" — the conclusion
is qualified, and the qualifications are the point.

---

## 2. Test summary

Fresh execution on the current tree:

| Check | Command | Result |
|---|---|---|
| Full test suite | `npx vitest run` | **339 passed / 339**, 23 files (clean isolated run) |
| Build | `npx next build` | **Pass** (TypeScript checked as part of the build) |
| Lint | `npx eslint src/ tests/` | **Pass**, no output |
| Migration drift | `npx prisma migrate status` | "Database schema is up to date!" (14 migrations) |

**Test files (23):** `phase1-tenant-isolation`, `phase2-university-config`,
`phase3-activity-logging`, `phase45-exceptions`, `phase456-analytics`,
`phase5-dashboards`, `phase6-analytics`, `phase65-scheduler`,
`phase7-ai-insights`, `phase78-insights-admin`, `phase8-reports-notifications`,
`phase9-instructor-isolation`, `phase9-role-architecture`,
`phase9-security-audit`, `phase10-gemini`, `phase10-provisioning`,
`phase10-rollup`, `workday-timezone`, `regression-activity-integrity`,
`regression-audit-findings`, `pagination`, `ai-narration-validation`,
`ai-narration-integration`.

**Added in the most recent work:** `pagination.test.ts` (29 tests),
`ai-narration-validation.test.ts` (20), `ai-narration-integration.test.ts` (9).

No test was weakened, skipped, or deleted to reach a green run.

**Known suite-level contention.** The suite uses one shared test database and a
fixed port (3100). It is **not safe to run two suites concurrently**, and doing
so is not a product defect — it is a property of the harness. During this
verification pass two full suites were launched simultaneously and produced
12 and 179 spurious failures respectively; re-running a single suite in
isolation, with no other process touching the harness, produced the clean
339/339 recorded above. Any failure observed under concurrent execution must be
reproduced in isolation before it is treated as real.

Separately, one genuine shared-fixture race *was* found earlier and fixed at the
root rather than retried away: `phase7-ai-insights.test.ts` asserted "no measured
condition without data" while other files concurrently created deliverables for
the same seeded instructors, legitimately tripping `DELIVERABLE_RISK` (which is
deliberately period-independent). Fixed by giving that test its own university
and instructor — commit `0d13dbe`.

---

## 3. Multi-tenancy and authorization

**Mechanism.** Opaque 32-byte random token in an httpOnly cookie
(`sameSite=lax`, `secure` in production, 12h default TTL). Only a SHA-256 hash
of the token is stored (`Session.tokenHash`); verification is a database lookup
on the hash, rejecting on missing/revoked/expired session or inactive user.
Passwords use **scrypt** (N=2¹⁵, r=8, p=1) with `timingSafeEqual`, plus a
dummy-hash delay on unknown accounts so login timing does not reveal account
existence.

**`TenantScope` is a tagged union** — `{kind:"global"}` / `{kind:"university"}` /
`{kind:"self"}` — so an admin's global access can never be an accidental
`WHERE universityId IS NULL`.

**Probed with real HTTP requests** (raw client, no browser, no frontend):

| Caller | Request | Result |
|---|---|---|
| anonymous | `GET /api/instructors` | `401 UNAUTHENTICATED` |
| anonymous | `GET /api/auth/me` | `401 UNAUTHENTICATED` |
| anonymous | `POST /api/instructors` | `401 UNAUTHENTICATED` |
| forged cookie | `GET /api/auth/me` | `401` |
| managerNorth | `GET /api/instructors?universityId=<westbrook>` | `403 CROSS_TENANT_DENIED` |
| managerNorth | `GET /api/universities/<westbrook>/audit` | `403 CROSS_TENANT_DENIED` |
| managerNorth | `GET /api/universities/<westbrook>/config` | `403 CROSS_TENANT_DENIED` |
| instructorNorth1 | `GET /api/universities/<westbrook>/audit` | `403 FORBIDDEN` (role gate — audit excludes INSTRUCTOR) |
| instructorNorth1 | `GET /api/instructors/<westbrookInstructor>` | `404` (does not confirm existence) |
| instructorNorth1 | `GET /api/instructors/<colleague>/deliverables` | `404 NOT_FOUND` |
| managerWest | `GET /api/universities/<north>/reports?export=csv` | `403 CROSS_TENANT_DENIED` |

**Deliberate 403-vs-404 split, confirmed:** a cross-tenant *scope widening*
returns a loud `403`; a specific record the caller should not know exists returns
`404`. Both behaviours are intentional and verified.

**Database-level invariants** (not merely application checks): a CHECK
constraint `user_role_tenant_binding` enforcing `ADMIN ⟺ universityId IS NULL`,
and a composite FK `(userId, universityId) → User(id, universityId)` on both
`Manager` and `Instructor` making a cross-tenant profile structurally
impossible.

`tests/phase1-tenant-isolation.test.ts` — 22/22 passed.

---

## 4. Activity integrity and analytics

### 4.1 Activity integrity — verified by real requests

| Case | Result |
|---|---|
| Overlapping interval (10:00–11:00 then 10:30–11:30) | `409 ACTIVITY_OVERLAP` |
| Fully contained, fully containing, identical | `409` (all three) |
| **Touching boundaries** (10:00–11:00 then 11:00–12:00) | **both `201`** — correct; half-open comparison uses `<`/`>`, not `<=`/`>=` |
| Two simultaneous identical creates (`Promise.all`) | exactly one `201`, one `409` |
| Second `DAILY_OPENING` same day | `409 DUPLICATE_ONCE_PER_DAY_ACTIVITY` |

Concurrency is serialised by `pg_advisory_xact_lock(hashtext('activity:{instructorId}:{workDate}'))`
taken inside the transaction before the checks — plus a database-level partial
unique index as a second line of defence.

**Timezone / work-date.** Posting `local: {date:"2033-01-10", start:"10:00",
end:"11:00"}` for a Kolkata university stored `startTime 04:30Z`, `endTime
05:30Z`, `workDate 2033-01-10` — the typed calendar date, resolved against the
*university's* IANA zone via `Intl.DateTimeFormat` (DST-safe), never the server's
or browser's.

### 4.2 The capacity identity — a correction

**Formula, verbatim from `engine.ts:569`:**
`utilizationPct = capacity > 0 ? round((productive / capacity) * 100) : null`
— exactly `productiveHours / capacityHours`, nothing else.

**Mutual exclusion of unutilized and missing-data: verified.** A day contributes
to one or the other, never both (`engine.ts:503-504`, `if (dayUnutilized ===
null) missing += …; else unutilized += …`). **No double-counting.**

**However — `capacityHours = productiveHours + unutilizedHours +
missingDataHours` is NOT a universal identity.** An earlier report in this
project's history stated it as if it always held. It does not. Two reachable
violations, both measured:

1. **Work on a non-working day.** `productive` is accumulated *before* the
   non-working-day early-exit, so productive hours are added while capacity is
   not. Measured: 1h Saturday + 2h Monday → `capacity 8, productive 3,
   unutilized 6, missing 0` → sum 9 ≠ 8.
2. **Overtime.** `Math.max(0, dayCapacity - dayProductive)` floors at zero.
   Measured: 9h logged against 8h capacity → `capacity 8, productive 9,
   unutilized 0, missing 0` → sum 9 ≠ 8, `utilizationPct 112.5`.

Both are reachable through the normal API — `logActivity` imposes no
working-day or window restriction. The UI already anticipates it
(`pct > 100` renders as "Over capacity"). **The correct statement is: the
identity holds on working days that have data and no overtime**, which is
exactly the condition the permanent suite asserts it under
(`tests/phase456-analytics.test.ts:146`).

**Also worth knowing:** `missingDataHours` remains inside the utilization
denominator. The engine separates "unknown" from "idle" in the breakdown, then
folds "unknown" back into the ratio. Measured: 2h logged across one recorded and
one blank working day → `utilizationPct 12.5` (2/16), not 25 (2/8).

### 4.3 Live reconciliation

Northfield: Mon–Fri 09:00–18:00 Asia/Kolkata, 60-minute break → 8h capacity by
hand. Logged one 2h TEACHING activity on a Monday, queried the analytics
endpoint for that single day:

```json
{ "capacityHours": 8, "productiveHours": 2, "unutilizedHours": 6,
  "missingDataHours": 0, "utilizationPct": 25,
  "hoursByActivityType": { "TEACHING": 2 }, "overlapHours": 0 }
```

Matches hand-calculation exactly. Adding a blank Tuesday produced
`capacity 16, productive 2, unutilized 6, missingData 8`, and that day's
`unutilizedHours` was **`null`, not `0`** — the "we measured zero" vs "there was
nothing to measure" distinction survives to the API.

### 4.4 Opening/closing separation — verified

Per-activity-type hours are keyed on the activity type's own `code` with no
mapping or folding. Measured across four types in one day:
`{DAILY_OPENING: 0.25, TEACHING: 2, LEARNING: 1, DAILY_CLOSING: 0.25}` —
TEACHING is exactly 2, opening/closing are not folded in.

Two caveats found: `hoursByActivityType` filters on status only, **not** on
`countsAsProductive`, so it includes non-productive types and
`sum(hoursByActivityType) ≠ productiveHours`; and it uses a naive per-log
duration sum rather than the union used for `productiveHours` (harmless while
overlaps are rejected at write time, which they are).

### 4.5 Rollup

Weekly metrics are **derived from the daily rows**, not recomputed from raw
activity — so a week is by construction the sum of its days. Verified: a week row
of `capacity 16 / productive 2` equalled the summed daily rows exactly.

Two defects found (see §15):
- **Partial weeks are written as whole weeks.** The code widens the date range
  but sums only the daily rows that exist, so a rollup over a 2-day window
  produced a week row with `capacityHours 16` where a real week is 40h — and it
  is exposed as the week's total.
- **`minutesByActivityType` is hardcoded `{}` on the weekly row**, despite the
  schema declaring it. An earlier fix (`7cfcbed`) corrected exactly this on the
  daily and university rows but missed the weekly one.

---

## 5. Deliverables

Verified end to end with real requests:

| Step | Result |
|---|---|
| Manager creates deliverable | `201`, `status: NOT_STARTED` |
| Instructor attempts to create one for themselves | `403 FORBIDDEN` (role gate fires before ownership) |
| Instructor logs progress (2 then 1 of target 5) | `201`, reads back `quantityCompleted 3`, `hoursSpent 1.5`, `status IN_PROGRESS` |
| Progress reaching target | `status COMPLETED` |
| Cross-instructor / cross-tenant read | `404 NOT_FOUND` |
| Cross-tenant create | `403`/`404` per role |

Status is recomputed from the log aggregate on every write and is not a
client-writable field.

**`DELIVERABLE_RISK` logic** (`anomalies.ts:178-194`): fires when
`total > 0 AND (overdue > 0 OR completionPct < 60)` — an **OR**, severity `HIGH`
iff overdue. Reproduced live on a dedicated probe university: a 10-unit
deliverable with zero logs past its due date produced
`{"type":"DELIVERABLE_RISK","severity":"HIGH","metrics":{"total":1,"overdue":1,"completionPct":0,…},"threshold":{"completionPct":60}}`.
Confirmed it is deliberately *not* suppressed when no activity was recorded,
unlike the activity-derived rules.

**Defect: `Deliverable.status` can never be `OVERDUE` or `CANCELLED`.** Both
values exist in the enum; no code path writes either. Overdue is computed ad hoc
(`dueDate < now`) and never persisted — yet frontend code filters on
`status === "OVERDUE"`, which cannot match a row. See §15.

---

## 6. Schedule

**What exists:** `GET` and `POST /api/instructors/{id}/schedule`. That is the
entire schedule API.

| Check | Result |
|---|---|
| Instructor creating a slot for themselves | `403 FORBIDDEN` — manager/admin only, by design |
| Cross-tenant manager creating a slot | `404 NOT_FOUND` |
| `DAILY_OPENING` / `DAILY_CLOSING` as a slot | `400 NOT_SCHEDULABLE` — derived from working hours, correctly rejected |
| `endTime <= startTime` | `400 INVALID_INTERVAL` |
| Malformed / non-real date | `400 INVALID_DATE` |
| `DELETE` on the route | `405` |

`GET` returns planned slots **and** the day's actual logged activity in one
response, alongside computed opening/closing windows.

**Gaps found, all verified by execution** (see §15):
- **No overlap validation.** Two slots at 04:00–06:00 and 05:00–07:00 for the
  same instructor/day both returned `201`. Nothing at the database level guards
  it either.
- **`workDate` is never cross-checked against `startTime`/`endTime`.** A slot
  dated `2026-08-20` with times on `2027-01-01` was accepted (`201`) and is
  invisible on both days' views.
- **An invalid `courseId` produces `500 INTERNAL_ERROR`.** It is passed straight
  to `create` with no existence or tenant check; the resulting Prisma `P2003` is
  unmapped (only `P2002` is handled), so a client input error surfaces as a
  server fault.
- **No edit or delete for slots** — create-and-read only.
- **The `Schedule` parent model is unused.** `prisma.schedule.*` has zero call
  sites; `ScheduleSlot.scheduleId` is never populated, so every slot is an
  orphan.
- **`ActivityLog.scheduleSlotId` is never written.** It is read in the route and
  the UI but no write path sets it, so planned and actual are returned side by
  side yet never linked — the UI's "against a slot" affordance cannot fire.

---

## 7. AI reliability

**Pipeline, verified in order:**

```
deterministic anomaly detection → AnomalyCondition → Gemini narration
   → validation → fallback on failure → persisted AiInsight
```

**The model never decides whether an anomaly exists.** `detectAnomalies` is a
plain synchronous function over named numeric thresholds — no `fetch`, no import
of the model layer. The model is invoked downstream, one already-decided
condition at a time.

**What is sent:** exactly `type`, `severity`, `scope`, `metrics`, `threshold`.
**What is not:** `instructorId` and `instructorName` are omitted from the request
payload entirely. `narrateCondition(condition)` takes one argument — no database
handle, no activity rows — so the "never send raw ActivityLog to the model"
requirement is enforced by the input type rather than by convention. The real
name is substituted **locally, after validation passes**; the model is instructed
to emit `{{SUBJECT}}` and never invent a name.

**The validator inverts the usual check.** Rather than confirming a true number
appears somewhere in the prose, it extracts *every* numeric and date-like token
and requires each to be justified by a value the condition actually produced
(rounded forms accepted as paraphrase). It additionally rejects invented
honorific-plus-name patterns, judgemental language about a person, and
comparisons the engine never computed. Any single violation fails the whole
narration, which is then **discarded, not repaired** — the rejected text is never
logged, only the rule it broke.

**Test evidence — `npx vitest run tests/ai-narration-validation.test.ts
tests/ai-narration-integration.test.ts` → 29/29 passed.** Observed rejection
logs:

```
[ai] narration failed validation for UNDERUTILIZATION (summary: unsupported number "91"); using deterministic text
[ai] narration failed validation for UNDERUTILIZATION (summary: unsupported date "2020-01-01"; …); using deterministic text
```

Failure modes each covered by a named passing test: hallucinated percentage,
hallucinated date, malformed JSON body, real timeout, HTTP 429, HTTP 500, and no
API key configured — all fall back to deterministic narration.

**Persistence:** insights are written with `sourceMetrics` and `supportingData`
carrying the exact condition, its metrics and its threshold, so every stored
insight remains traceable to the numbers it came from.

---

## 8. Pagination

Six endpoints use `parsePage`. **Their parameter surfaces are not symmetric** —
this is the single most misdocumented area historically, so it is tabulated
exactly:

| Endpoint | search | sort/order | default limit | max | Pagination UI |
|---|---|---|---:|---:|---|
| `GET /api/universities` | **yes** — name, code, slug | **yes** — `name`/`code`/`createdAt`; invalid → `400 INVALID_SORT` | 50 | 200 | yes |
| `GET /api/instructors` | **yes** — user.name, user.email, employeeCode, university.name | **no** — hardcoded `createdAt asc`; `sort`/`order` **silently ignored**, returns `200` | 50 | 200 | yes |
| `GET /api/universities/[id]/audit` | no (`action`/`entityType` exact filters) | no — `createdAt desc` | **100** | 200 | yes |
| `GET /api/universities/[id]/reports` | no | no | 50 | 200 | yes (ignored on `?export=csv`) |
| `GET /api/instructors/[id]/deliverables` | no | no — `dueDate asc` | 50 | 200 | **no** |
| `GET /api/instructors/[id]/activities` | no (`from`/`to` filters) | no — `startTime asc` | **100** | **500** | yes |

**Validation**, identical on all six: malformed/`NaN`/`Infinity` → `400`
(`INVALID_PAGE` / `INVALID_LIMIT`); `0` or negative → `400 "must be at least 1"`;
**oversized limit is silently clamped to max, never rejected**; oversized page
returns an empty `200` page, not a `404`; fractional values are silently
truncated.

**Response shapes differ**: `/api/universities` and `/api/instructors` add a
`scope` key; `/api/instructors/[id]/activities` adds `timezone`;
`/api/universities/[id]/reports` nests its array at `report.rows` rather than at
the top level, and its `report.totals` is computed over the whole university and
is *not* re-derived from the visible slice.

**Isolation under pagination, probed live:** unauthenticated requests → `401` on
all tested endpoints; a manager searching for another tenant's records → `200`
with an empty array and `total: 0` (never the foreign row); explicit
cross-tenant ids → `403` (or `404` on instructor-scoped routes, which do not
confirm existence).

`tests/pagination.test.ts` — 29/29 passed.

**Frontend consumption:** seven pages render the shared `Pagination` control,
covering five of the six endpoints. Eight call sites bypass paging with
`limit=200` — seven are genuine picker dropdowns (choosing a university or
instructor, where click-through paging inside a `<select>` makes no sense); the
eighth, `instructor/deliverables`, is a main list view, for the stat-tile reason
below.

**Gap: `/api/instructors/[id]/deliverables` has no Pagination UI anywhere.**
`instructor/deliverables` requests `limit=200` (exactly the server max, so a
201st deliverable is silently invisible) and **`manager/deliverables` passes no
limit at all**, taking the fallback and silently truncating at **50 per
instructor**. The deliverables view renders aggregate stat tiles computed over
the whole fetched array, which is why it was given a raised limit rather than
click-through paging — but the manager-side call site does not even do that. See
§15.

---

## 9. Performance

**Admin overview N+1 removal.** Previously 4 queries per university. Universities
are now grouped by resolved reporting period, each group running one batched
`groupBy`/`findMany({where:{universityId:{in:[…]}}})` per concern; the
active-instructor count is period-independent and batched once across all.

| Universities | Before | After |
|---:|---:|---:|
| 3 | 12 | 4 |
| 10 | 40 | 4 |
| 100 | 400 | 4 |

**These figures were measured when the change was made and were NOT re-measured
in this pass.** What *was* re-verified this pass: the current code structure
contains no per-university query loop, and the grouping logic is as described.
O(1) holds when `?from=`/`?to=` are supplied (all universities resolve to one
period); otherwise it is O(distinct resolved periods), bounded by timezone count
— never O(N).

**Pagination indexes**, measured on a targeted bulk dataset:
`ActivityLog (instructorId, startTime)` 12.8 ms → 0.07 ms on page one (20k rows
for one instructor); `Instructor (universityId, createdAt)` 6.6 ms → 0.07 ms and
`(createdAt)` 7.4 ms → 0.06 ms on a 20,514-row table. Deep-offset pagination
remains O(offset) regardless of index (~10.5 ms → ~9.4 ms at offset 15,000) —
a property of OFFSET paging, not something an index fixes.

Dashboard-query figures against the 3.9M-row Phase-10 dataset are in
[DATABASE-ARCHITECTURE.md](DATABASE-ARCHITECTURE.md) §6 and were **not**
re-measured this pass.

**Remaining N+1 / scale risks:** `/api/admin/overview` is itself unpaginated —
its query count is constant but its response size and per-row work remain O(N)
in universities.

---

## 10. Security

- **Rate limiting** on `POST /api/auth/login` only, keyed by **both** IP and
  account email (whichever trips first). Defaults 30/5min per IP, 10/5min per
  email, env-overridable. **In-memory, per-process, fixed-window** — the module
  states plainly that behind multiple instances the effective limit multiplies
  and a restart clears counters. Bounded at 10,000 tracked keys.
- **CSV formula injection — neutralised, verified on raw bytes.** An instructor
  named `=cmd|'/C calc'!A0` exported as `'=cmd|'/C calc'!A0` — guard apostrophe
  prefixed. Guard set: `= + - @ tab CR`. Sanitisation is export-time, not
  input-time (the raw value is stored and echoed unmangled, which is correct).
- **Error bodies leak nothing.** A genuinely triggered 500 returned
  `{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong"}}`; the
  Prisma stack and internal paths went to the server log only. Checked
  programmatically for stack frames, file paths, `PrismaClient` and SQL keywords
  — no match. Validation errors return `400 VALIDATION_ERROR` with field-level
  Zod issues only.
- **Exactly two hand-written `catch` blocks in the API tree.** The report-export
  path writes `error.message` to a database column and rethrows to the central
  handler; the health check returns a `503` carrying no error detail. No route
  returns `error.stack` or a raw Prisma message to a client.
- **Export tenant isolation:** cross-university export → `403
  CROSS_TENANT_DENIED`; the owning manager → `200`.
- **Input validation:** malformed JSON and wrong-typed fields return `400`, not
  `500`, on every endpoint probed.

**Exception:** an invalid `courseId` on schedule-slot creation returns `500`
(§6) — the one confirmed case where a client input error is reported as a server
fault.

---

## 11. Export verification

Verified on **raw bytes** (`arrayBuffer()`, never `.text()`, which would strip a
BOM and give a false negative):

- **UTF-8 BOM present** — first three bytes `EF BB BF`.
- **RFC-4180 escaping.** An instructor named `=SUM(A1,"x")` exported as
  `"'=SUM(A1,""x"")"` — guard apostrophe applied first, whole field quoted
  because it contains a comma and a quote, interior quote doubled. A plain
  `Smith, Jane` exported as `"Smith, Jane"` — quoted for the comma, no guard
  added, confirming the guard is prefix-conditional rather than blanket.
- **Totals match the JSON report** for the same university and period — row
  count and every compared per-row numeric field matched exactly. Both paths
  consume one `computeAnalytics` result.
- **Tenant scope.** A self-scoped instructor's export contained exactly one data
  row — their own. The same period as manager returned four, confirming the
  restriction is scope-conditional.
- **No timestamp column exists** in the export, so there is no per-row
  timezone ambiguity to resolve. The period bounds are calendar dates resolved
  in the university's timezone.
- **XLSX / PDF: NOT IMPLEMENTED**, confirmed by exhaustive grep — no `xlsx`,
  `exceljs`, `pdfkit` or equivalent dependency, and no route producing either
  format.

---

## 12. Browser verification

Performed with a real headless Chromium driving the running application against
seeded data — not asserted from API tests.

**Verified in-browser:**
- Pagination controls on the admin instructors and admin universities lists:
  correct `Page N of M · T total` text, correct Previous/Next disabled states at
  boundaries, row content genuinely changing between pages, Previous returning
  correctly.
- Server-side search narrowing results and resetting to page 1.
- Admin audit log paging through a 424-row filtered set (`Page 1 of 5` → `Page 2
  of 5`, list contents changed).
- Responsive layout at **375 / 768 / 1024 / 1440 px** across all 24 pages that
  use the shared page header with actions: no horizontal overflow, controls
  within viewport. A real overflow defect found at 375px during this check was
  fixed and re-verified.

**Not verified in-browser:** every remaining page and interactive control;
cross-browser behaviour (Chromium only — no Firefox or WebKit run).

---

## 13. NOT VERIFIED

Stated explicitly rather than left to inference:

- **Admin-overview query counts were not re-measured this pass.** The 12/40/400
  → 4 figures come from the commit that made the change. Only the code structure
  was re-confirmed.
- **Dashboard-query timings on the 3.9M-row dataset were not re-measured.**
- **Scale beyond the tested datasets** — 100 universities / 10,000 instructors /
  3.9M activities (Phase-10) and the smaller pagination dataset. Anything larger
  is projected from query plans, not demonstrated. No 1,000-university or
  500,000-instructor run exists.
- **Cross-browser rendering** — Chromium only.
- **Most pages and interactive controls were not individually browser-tested**;
  §12 lists what was.
- **Rate limiting was not load-tested** in this pass — the code path was read and
  an existing test covers it, but no fresh 429-tripping run was performed here.
- **The live Gemini provider was not exercised.** All AI verification used a
  local stub and the deterministic fallback path. No real API key run.
- **CSV edge cases beyond those listed** in §11 — e.g. very large exports,
  non-Latin scripts beyond BOM handling, embedded newlines in fields.
- **`prisma migrate diff` does not detect the undeclared partial index**
  documented in [DATABASE-ARCHITECTURE.md](DATABASE-ARCHITECTURE.md) §8, so
  "no drift" is verified only for what Prisma tracks.
- **Deployment to Render has not been performed** from this codebase state.

---

## 14. NOT IMPLEMENTED

Confirmed absent by direct inspection, not assumed:

- **Activity edit and delete.** The route exports only `POST` and `GET`; no
  `PATCH`/`PUT`/`DELETE` and no `[activityId]` subroute exists. `ActivityLog` has
  no `deletedAt` while six other models do. Note that `logActivity` accepts an
  `excludeActivityId` intended for re-validating an edit, but **no caller
  anywhere passes it** — half-built plumbing with no HTTP surface. The product
  decision is recorded in the README's "Known gaps".
- **XLSX and PDF export** — CSV only (§11).
- **Schedule slot edit and delete** — create-and-read only; `DELETE` returns
  `405`.
- **The `Schedule` parent model** — declared, indexed, and never used by any code
  path.
- **Cursor/keyset pagination** — OFFSET only.
- **Pagination on `/api/admin/overview`.**
- **Overlap validation for schedule slots** — no application or database guard.
- **`Deliverable.status` transitions to `OVERDUE`/`CANCELLED`** — enum values
  exist, nothing writes them.
- **Redis / BullMQ / caching layer** — the rollup uses an in-process scheduler
  with a database lease.
- **Partitioning, read replicas, RLS** — reasoned about in
  [DATABASE-ARCHITECTURE.md](DATABASE-ARCHITECTURE.md), deliberately not applied.

---

## 15. Remaining risks

**P0 — none identified.** No data-corruption, cross-tenant leak, or
system-unusable defect was found in this pass.

**P1 — none identified.**

**P2 — real defects with user-visible consequences:**

| # | Defect | Consequence |
|---|---|---|
| 1 | Invalid `courseId` on schedule-slot create returns `500 INTERNAL_ERROR` (Prisma `P2003` unmapped) | A client input error is reported as a server fault; no actionable message |
| 2 | Partial weeks are written as whole weeks in the weekly rollup | A week row can understate the real week and is exposed as the week's total |
| 3 | `manager/deliverables` fetches with no limit, silently truncating at 50 per instructor | Deliverables beyond the 50th are invisible with no indication |
| 4 | `Deliverable.status` never becomes `OVERDUE`; UI filters on it | The overdue view can never match a row |
| 5 | No overlap validation on schedule slots | An instructor can be double-booked with no warning |

**P3 — correctness/consistency issues with limited blast radius:**

| # | Issue |
|---|---|
| 6 | `ActivityLog.scheduleSlotId` never written — planned and actual are never linked |
| 7 | Schedule `workDate` not cross-checked against slot times; a mismatched slot is invisible on both days |
| 8 | `minutesByActivityType` hardcoded `{}` on weekly metric rows |
| 9 | `overlapMinutes` hardcoded `0` on daily metric rows |
| 10 | `sort`/`order` silently ignored (not rejected) on `/api/instructors`; `order` unvalidated on `/api/universities` |
| 11 | `instructor/deliverables` requests exactly the server max (200) — a 201st row is silently invisible |
| 12 | `InstructorWeeklyMetric` is API-exposed but no page renders it |
| 13 | The once-per-day partial unique index is absent from `schema.prisma` and invisible to `migrate diff` |
| 14 | Deep-offset pagination remains O(offset) |
| 15 | Suite-level flakiness under full-parallel execution (shared DB + fixed port) |

---

## 16. Production readiness

**Verdict: READY FOR STAGING. NOT YET "production ready" without qualification.**

**What supports readiness.** Tenant isolation, authorization, activity
integrity (including the concurrency race), the AI hallucination gate, CSV
export safety, and error-body hygiene were each verified this pass with real
requests and real bytes — not inferred. 339/339 tests pass, the build and lint
are clean, and there is no migration drift. No P0 or P1 defect was found.

**What holds back an unqualified claim.** Five P2 defects remain open (§15),
including one endpoint that returns a 500 on ordinary bad input and two places
where data is silently truncated or understated — the failure mode being
*silence*, which is the kind a user cannot detect. Separately, scale is
demonstrated only to 100 universities / 3.9M activity rows; the 5,000-university
target in the architecture document is projected from query plans, not measured.
The live AI provider has never been exercised — only a stub and the fallback
path.

**Recommended before an unqualified production claim:** fix the five P2 items;
exercise the real Gemini provider once against a live key; and either paginate
`/api/admin/overview` or establish the university count at which its O(N)
response becomes a problem.

None of these are architectural. They are bounded, individually small, and
listed here specifically so that shipping is a decision made with them in view
rather than around them.
