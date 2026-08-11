# Phase 0 — Audit & Gap Analysis

**Date:** 2026-08-11
**Repo:** `/Users/rajakumar/tracksheet`
**Status:** No code written this phase.

---

## 1. Audit finding: there is nothing to audit

The working directory is empty. No source files, no hidden files, no `.git`, no
package manifest, no database, no migrations.

Consequences for the plan as written:

| Phase 0 question | Answer |
|---|---|
| 1. Current architecture | None exists. |
| 2. Reusable auth / tenant / RBAC / scheduling / reporting | Nothing to reuse. |
| 3. Broken, incomplete, duplicated | N/A. |
| 4. Can the schema represent multi-tenancy? | No schema exists; designed fresh in Phase 1. |
| 5. Does RBAC exist, and is it server-side? | Does not exist. |
| 6. Mapping target model onto existing tables | No tables to reuse, rename, or replace. |
| 7. Does the app assume separate portals per role? | No app exists, so the single-login model is the starting point, not a correction. |

The plan's stated purpose for Phase 0 — surface conflicts between the existing
codebase and the target design *before* Phase 1 commits to a direction — still
applies. On greenfield, the conflicts are not with legacy code but with
**underspecified points in the plan itself**. Those are in §3, and they are the
real output of this phase.

---

## 2. Recommended stack

**Recommendation: Next.js (App Router, TypeScript) + Route Handlers as the API +
Prisma + PostgreSQL + httpOnly cookie sessions.**

Why this fits the stated constraints:

- **"One web application, one login page."** A single Next.js app is literally
  that. `/dashboard` renders `<AdminDashboard> | <ManagerDashboard> |
  <InstructorDashboard>` off the session role, on one route.
- **"Shared API routes, no role-specific duplicates."** Route Handlers are real
  HTTP endpoints. Phase 1's requirement to prove enforcement with a *raw API
  call that bypasses the frontend* works unchanged — `curl` hits the same
  handler the browser does. (This is why I am not recommending Server
  Actions as the primary data path; they are harder to attack from outside the
  app, which makes the isolation tests weaker.)
- **"Backend is the sole source of truth for calculations."** All duration,
  capacity, and utilization math lives in server-only modules that the client
  cannot import.
- **Relational + reporting-heavy.** PostgreSQL: date ranges, generated columns,
  partial unique indexes, and window functions all matter for Phases 2, 4, 6.
  Prisma gives typed access and a real migration history.
- **Single deployable.** One app, one deploy, no CORS, no token-passing between
  origins.

**Serious alternative:** NestJS API + React (Vite) SPA. Choose this if a separate
mobile or third-party client is likely, or if you want NestJS `Guards` as the
literal implementation of the "centralized authorization layer." The cost is two
deployables, CORS, and cross-origin auth. For a v1 with one web client, it is
extra surface area.

**Auth mechanism — httpOnly, SameSite cookie sessions backed by a `sessions`
table, not stateless JWT.** Rationale: instant revocation when a manager's
university assignment changes or an account is disabled; no token in JS-readable
storage; role and `universityId` are re-read from the server on each request
rather than trusted from a signed blob that may be stale. Statelessness is not a
concern at this scale.

**Testing:** Vitest + Supertest-style raw HTTP calls against a running server,
plus a seeded test database. The Phase 1 gate explicitly demands tests that
bypass the frontend, so the harness must hit real HTTP from the start.

---

## 3. Conflicts and underspecified points to resolve before Phase 1

These are the items the plan says should surface now rather than being quietly
decided by an implementer. Each has my recommendation.

### 3.1 Are `managers` / `instructors` identities or profiles?
The schema lists `users`, `managers`, and `instructors` as separate tables.
**Recommendation:** `users` is the sole identity and auth record (email, password
hash, role). `managers` and `instructors` are *profile* tables with a 1:1
`userId` FK carrying role-specific fields. Avoids duplicate identities and makes
"one login page" trivially true. Requires deciding this now — retrofitting it
after Phase 3 is expensive.

### 3.2 Enforcing "once per working day" at the database layer
The Phase 2 gate requires this be enforced in the DB or service layer, not the
UI. **Recommendation:** store an explicit `workDate` (a `DATE`, computed in the
university's timezone at write time) on opening/closing records, and add a unique
index on `(instructorId, workDate)` per table — or a partial unique index on
`activity_logs (instructorId, workDate)` filtered to the two activity types.
Timestamps alone cannot express this constraint. **This decision must be made in
Phase 1's schema**, not deferred to Phase 2, because the column has to exist.

### 3.3 Timezone and the definition of "a working day"
Every university has its own timezone and working hours, so "today" is
per-tenant. **Recommendation:** persist all instants as `timestamptz` in UTC;
derive `workDate` by converting to the university's IANA timezone. Never use the
server's local date, and never use the browser's. Affects §3.2's uniqueness
constraint directly.

### 3.4 Overlapping activities: reject or merge?
Phase 3 requires overlaps not double-count, which implies overlaps are *storable*
but must be reconciled at calculation time. That is a different system than one
that rejects overlaps on write. **Recommendation:** allow storage (real days are
messy; a class can run into a support session), and have the analytics engine
compute worked time as the **union of intervals**, not the sum of durations.
Flag overlaps as a data-quality signal rather than an error. Confirm this is the
intent before Phase 3.

### 3.5 `MISSING_DATA` is derived, never stored
The rule "never collapse no-record into 0 hours worked" means `MISSING_DATA` is
the *absence* of rows over a window that the university's config says should be
covered. **Recommendation:** it is never persisted as a row and never appears in
`activity_types`. The API returns it as an explicit computed state alongside
`UNUTILIZED`, so a client can always tell "we know this was idle" from "we don't
know what happened." Note the tension: `activity_types` in Phase 2 seeds
`UNUTILIZED` but not `MISSING_DATA`, which is correct and should stay that way.

### 3.6 `ABSENCE` vs `LEAVE`
Both appear in the hard rules with no definition. **Recommendation:** `LEAVE` is
an approved `leave_requests` record — it *reduces available capacity*. `ABSENCE`
is an unapproved or unexplained no-show during expected working hours — it does
*not* reduce capacity and is a compliance signal. Getting this backwards inverts
the Phase 4 utilization test.

### 3.7 "One primary manager per university (v1)"
Enforce as a unique constraint or leave as convention? **Recommendation:** model
`managers.universityId` as a normal FK and add a `universities.primaryManagerId`
nullable FK for the v1 "one primary" rule. Keeps the door open for multiple
managers later without a migration that splits a column.

### 3.8 Where the admin's null `universityId` is handled
Admin has `universityId = null`. If the central authorization layer naively
appends `WHERE universityId = session.universityId`, admin queries silently
return nothing. **Recommendation:** the authorization layer returns an explicit
tenant *scope* object (`{kind: 'global'} | {kind: 'university', id} | {kind:
'self', instructorId}`) that every query builder must consume, so "global" is a
deliberate branch rather than an accidental null. Design this in Phase 1 — it is
the single most likely place isolation breaks later.

---

## 4. Proposed Phase 1 entry state

Once §3 is settled, Phase 1 begins with:

1. Scaffold Next.js + TypeScript + Prisma + PostgreSQL, plus the raw-HTTP test
   harness.
2. Schema: `users`, `universities`, `university_working_hours`,
   `university_holidays`, `managers`, `instructors`, `sessions` — with
   `universityId` on every tenant-scoped table and the `workDate` groundwork from
   §3.2.
3. `POST /auth/login`, cookie session issuance.
4. The tenant-scope authorization layer from §3.8, with no endpoint doing its own
   ad hoc check.
5. Seed data: one admin, two universities with *different* working hours and
   timezones (Phase 2's gate needs this), one manager and two instructors each.
6. The four Phase 1 isolation tests, run over raw HTTP.

No dashboards, no business features.

---

## 5. Open questions for you

1. Confirm the stack (§2), or name your constraint if a different one is required.
2. Confirm or correct §3.4 (overlaps allowed and merged) and §3.6 (`LEAVE`
   reduces capacity, `ABSENCE` does not) — these two most change downstream math.
3. Is PostgreSQL available locally, or should Phase 1 include a Docker Compose
   for it?
