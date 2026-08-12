# Database Architecture

Target scale: 5,000 universities · 500,000 instructors · hundreds of millions of
activity records.

Every performance claim below is a measurement taken against a generated dataset
of **100 universities / 10,000 instructors / 3.9M activity logs / 760 MB**, not
an estimate. The generator is [prisma/perf-seed.sql](prisma/perf-seed.sql) and is
reproducible.

---

## 1. Audit of the schema as it stood

16 tables, all tenant-scoped tables carrying `universityId`. Tenant isolation was
already enforced server-side and verified. What the audit found:

| Finding | Evidence |
|---|---|
| `ActivityLog` had `(universityId)` and `(instructorId, workDate)` but no `(universityId, workDate)` | Manager week query read 39,000 rows to return 3,000 — `Rows Removed by Filter: 36000` |
| Admin cross-university aggregate had no supporting structure | `Parallel Seq Scan`, 399 ms cold / ~28 ms warm |
| `AuditLog`, `AiInsight` indexed on tenant only, not `(tenant, createdAt)` | Time-ordered reads unsupported |
| `Notification` indexed on `userId` only | §40 wants `(userId, readAt, createdAt)`; `isRead` boolean cannot express "when" |
| `DeliverableLog` had no tenant column at all | A tenant-scoped read required a join to be safe |
| No academic structure | No `Department`/`Program`/`Course`/`AcademicTerm`/`CourseAssignment` |
| No scheduling | No `Schedule`/`ScheduleSlot`, so planned-vs-actual was impossible |
| No aggregation layer | Every dashboard read hit raw `ActivityLog` |
| Configuration lived on the `University` row | §9 wants it separated |
| No soft delete | Deleting an instructor would take their history with them |

Reused unchanged because they were already correct: the `User` + `Manager`/
`Instructor` profile split (§6), the composite FK preventing a profile from
sitting in a different university than its user, the `ADMIN ⟺ universityId IS
NULL` CHECK, and the partial unique index enforcing one opening/closing per
instructor per working day (§50).

---

## 2. Data model

31 tables, grouped per §53.

```
IDENTITY     User · Manager · Instructor · Session
TENANCY      University · UniversitySettings · UniversityWorkingHours
             UniversityHoliday · BreakPolicy
ACADEMIC     Department · Program · Course · AcademicTerm · CourseAssignment
SCHEDULING   Schedule · ScheduleSlot
WORKFORCE    ActivityType · ActivityLog · LeaveRequest · WorkloadTarget
DELIVERABLES Deliverable · DeliverableLog
ANALYTICS    InstructorDailyMetric · InstructorWeeklyMetric
             UniversityDailyMetric
AI           AiInsight
REPORTING    ReportingPeriod · ReportJob
SYSTEM       Notification · AuditLog
```

Deliberate modelling decisions:

- **Opening/closing are generalised activities, not their own table.** §11 offers
  either; the generalised route was already in place with a partial unique index
  on `(instructorId, workDate, activityTypeId) WHERE isOncePerDay`, which
  enforces §50 at the database level. A separate `daily_workday_records` table
  would have duplicated the time model for no gain.
- **`DeliverableLog` carries its own `universityId` and `instructorId`** rather
  than reaching them through `Deliverable`. Denormalised on purpose: a
  tenant-scoped query must not need a join to be safe, and it is the index the
  table is read by.
- **Metrics are stored in minutes as integers**, not hours as floats — summing
  millions of floats accumulates drift.
- **`AiInsight.scope` is constrained against its subject columns** so a
  PLATFORM-scoped insight cannot quietly carry a tenant id.

---

## 3. Tenant isolation

Unchanged in principle, extended to new tables. `TenantScope` is a tagged union
(`global` / `university` / `self`); handlers never see a client-supplied
`universityId`, and narrowing within scope is allowed while widening is a 403.

**Row-Level Security was evaluated and deliberately not adopted.** RLS needs the
tenant on the *session*, set via `SET LOCAL` inside the transaction that runs the
query. Prisma's pooled connections and its own transaction handling make that
fragile: a `SET LOCAL` on a pooled connection that is then reused outside the
transaction silently applies the wrong tenant, which is worse than no RLS. The
brief itself warns against adopting RLS for its own sake (§52). Application-level
isolation is mandatory regardless and is verified by 115 tests. RLS becomes
attractive if raw SQL access outside Prisma is ever introduced.

---

## 4. Index strategy

Driven by the three real dashboard queries, not added speculatively.

```
ActivityLog   (instructorId, workDate)                 instructor dashboard
              (universityId, workDate)                 manager dashboard
              (universityId, instructorId, workDate)   manager drill-down
ScheduleSlot  same three shapes
DeliverableLog (universityId, instructorId, workDate) · (deliverableId, workDate)
Deliverable   (universityId, status) · (instructorId, status) · (universityId, dueDate)
AuditLog      (universityId, createdAt) · (userId, createdAt) · (entityType, entityId)
Notification  (userId, readAt, createdAt)
AiInsight     (universityId, createdAt) · (instructorId, createdAt) · (scope, status)
UniversityDailyMetric  (universityId, metricDate) unique · (metricDate)
InstructorDailyMetric  (instructorId, metricDate) unique · (universityId, metricDate)
```

The bare `(universityId)` index on `ActivityLog` was **dropped**: it is a prefix
of `(universityId, workDate)`, so it served no query while still costing on every
write. Indexes are only useful when they earn their write cost.

### Measured effect

Figures are warm-cache, best of three, re-measured across two sessions. Where
the two sessions disagreed the range is given — single samples on a laptop under
Docker are noisy, and quoting one would overstate the precision.

| Query | Before | After | Plan change |
|---|---:|---:|---|
| Manager, one university, one week | 44.5 ms | **1.2–2.2 ms** | Bitmap scan over 39k rows → index scan over exactly 3k |
| Manager, one university, one month | 6.0 ms | **2.2 ms** | Heap scan → Index Only Scan |
| Instructor, own week | 0.15–1.3 ms | unchanged | Already correctly indexed |
| Admin, platform-wide week | 28–65 ms warm (399 ms cold) | **0.8–1.3 ms** | Parallel Seq Scan → summary table |

`Rows Removed by Filter` on the manager query went from 36,000 to zero — that
structural change is what matters, more than any single timing.

The admin figure is the one to read carefully: the *before* number degrades
linearly with total platform activity, while the *after* number depends only on
universities × days. The gap widens with scale.

---

## 5. Aggregation strategy

The admin query was a sequential scan at *100* universities. No index fixes a
full-platform aggregate, so the read path changes rather than the index set.

```
ActivityLog (source of truth)
   ↓ rollupUniversityDaily()   ← calls the SAME analytics engine as the dashboards
InstructorDailyMetric · UniversityDailyMetric
   ↓
admin overview · instructor metrics
   ↓ drill-down goes back to ActivityLog
```

**The rollup does not reimplement the workload maths.** It calls
`computeAnalytics`, so a summary row cannot disagree with a drill-down into the
activity that produced it. Reimplementing the maths for speed is precisely how
reporting and dashboard numbers diverged in this codebase before.

Properties, all covered by tests:
- **Idempotent** — upserts on `(instructorId, metricDate)` / `(universityId,
  metricDate)`, so a late-submitted activity corrects the day rather than
  duplicating it.
- **A cache, not a second truth** — rebuildable from `ActivityLog` at any time.
  A test asserts a late activity is invisible until recomputed, then correct.
- **Preserves `MISSING_DATA`** — a working day with no records stays distinct
  from a day measured as unutilised, through the summary layer.

Chunked writes (500 rows/transaction) so the job never holds long locks on a
table dashboards are reading.

---

## 6. Migration plan

Eleven migrations, ordered, no drift (`prisma migrate diff --exit-code` = 0), and
verified to build the full 31-table schema from an empty database.

The phase-10 migration is safe against populated tables (§61). Every column that
ends up `NOT NULL` is added nullable → backfilled from real data → constrained:

- `University.code` — generated as `UNIV###` by creation order.
- `AiInsight.periodStart/End` — parsed from the existing free-text `period` where
  it is a real date range, otherwise the row's own `createdAt`. Nothing invented.
- `DeliverableLog.universityId/instructorId` — derived from the parent deliverable.
- `Deliverable.status` — `ActivityStatus` values mapped into `DeliverableStatus`
  through a temporary column, not dropped and recreated.
- `DeliverableLog.date` → `workDate` is a **RENAME**. The generator emitted
  `DROP COLUMN` + `ADD COLUMN`, which would have destroyed every logged entry.

**Measured cost: 18.7 s** to apply against the 3.9M-row database, dominated by
building the three new composite indexes. That is the number to plan a
maintenance window around; at 10× the data expect roughly 10× that, and the
index builds should move to `CREATE INDEX CONCURRENTLY` outside a transaction.

---

## 7. Performance strategy

**Now.** PostgreSQL + Prisma, query-driven indexes, daily rollups. Measured
above; the slowest dashboard path is 2.2 ms at 3.9M rows.

**Partitioning — designed for, not yet applied.** `ActivityLog` and `AuditLog`
are the time-series candidates and both carry a `DATE` column suited to RANGE
partitioning. It is not applied because the brief is explicit (§32) about not
partitioning on theoretical scale, and at 3.9M rows the indexed queries run in
single-digit milliseconds. The trigger to revisit: `ActivityLog` past ~50M rows,
or index maintenance windows becoming disruptive. Nothing in the schema blocks it
— the partition key already exists.

**Projected growth.** Raw activity scales with instructors × days; the summary
scales with universities × days. At 5,000 universities the raw table grows ~50×
(to ~195M rows) while `UniversityDailyMetric` grows to ~325k rows. That
divergence is the point of the aggregation layer.

---

## Not implemented

Stated plainly rather than implied:

- **Redis and BullMQ.** Superseded by Phase 6.5: the rollup now runs on an
  in-process scheduler started from `instrumentation.ts`, with a database lease
  for multi-instance safety. That is sufficient for a single long-running Node
  deployment and needs no extra infrastructure. A queue becomes necessary if the
  app is deployed serverless (no long-lived process to hold a timer) or if the
  rollup grows beyond what one instance can finish inside a tick. No caching
  layer and no rate limiting yet.
- **`ReportJob` is a schema and a contract, not a pipeline.** Nothing writes to
  it; exports are still generated synchronously. Fine at current volumes, not at
  the target.
- ~~`InstructorWeeklyMetric` is defined but not populated.~~ Resolved in Phase
  6.5: weekly rows are derived from the daily rows in the same job, so a week is
  by construction the sum of its days rather than a third computation.
- **Partitioning, read replicas, RLS** — reasoned about above, not applied.
- **UUIDv7.** IDs remain `cuid()`, which is already non-sequential and
  collision-resistant. Rewriting every primary key and foreign key across 31
  tables is a high-risk migration whose benefit here is stylistic; §1 says not to
  replace what works. Revisit if IDs ever need to be generated outside the
  database.
- **`User.firstName`/`lastName`.** Kept as a single `name`. Splitting names is a
  well-known internationalisation failure; this is a deliberate deviation.
- **Load testing beyond 100 universities.** Measured at 100 / 10,000 / 3.9M.
  Larger synthetic runs are not done, so scale beyond that is projected from
  query plans, not demonstrated.
- **Academic and scheduling tables have no API or UI yet.** The schema, indexes,
  and constraints exist; endpoints do not.
