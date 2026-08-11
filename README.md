# Tracksheet — University Workforce Intelligence Platform

One web application, one login page. After authenticating, the session's role
decides which dashboard renders. API routes are shared across roles; the
response differs only because the backend scopes it.

**Current state: Phase 1 complete** (schema, auth, tenant isolation).
No dashboards or business features yet — those are Phases 2–5.

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

## Running the Phase 1 gate

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
src/app/api/               login, logout, me, universities, instructors
tests/                     raw-HTTP tenant isolation gate
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm test` | Phase 1 isolation gate |
| `npm run db:up` / `db:down` | Start / stop Postgres |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Reseed |
