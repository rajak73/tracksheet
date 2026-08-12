# Deploying to Render

Blueprint: [render.yaml](render.yaml).

## Plan and instance count — read this first

| Setting | Value | Why it matters |
|---|---|---|
| Plan | `starter` or above | **Not free.** Render free web services sleep after inactivity. A sleeping instance stops the rollup timer and clears rate-limit counters on every wake — the exact regression Phase 6.5 exists to prevent. |
| `numInstances` | **1** | Load-bearing, not a cost decision. See below. |
| Region | `oregon` | Any region; keep the database in the same one. |

**Single instance is a correctness requirement today**, for two reasons:

1. **The rollup scheduler is an in-process timer.** Two instances would each
   run it. This is *safe* — the database lease means the second finds the lease
   held and skips — but it is wasted work and doubles the load.
2. **The login rate limiter counts in memory.** Two instances keep separate
   counters, so an attacker would get roughly 2× the intended attempt budget.
   This one is a genuine weakening, not just waste.

**Before raising `numInstances`, move the rate limiter to Redis.** The
scheduler is already multi-instance-safe because of the lease; the rate limiter
is not. `hit()` in [rate-limit.ts](src/server/http/rate-limit.ts) is the only
function that changes.

## Database

Render managed Postgres (`tracksheet-db` in the blueprint), same region as the
web service.

**On the Phase 6.5 pooling bug:** the fix was to stop holding a session-level
advisory lock across the rollup, because under *any* connection pool the lock
and unlock can land on different connections. That fix does not depend on
Render's setup — it removed the assumption entirely rather than tuning around a
particular pool. The lease is claimed inside a single transaction, which is
guaranteed to be one connection wherever it runs.

Render's managed Postgres does not put PgBouncer in front by default, so Prisma
connects directly. If you later add PgBouncer in **transaction** mode, revisit:
prepared statements and session state behave differently there, and
`?pgbouncer=true` must be appended to `DATABASE_URL`.

## Migrations

`preDeployCommand: npx prisma migrate deploy` — runs **before** the new instance
serves traffic, so the schema is never behind the code expecting it. No manual
step.

Seeding is deliberately **not** automatic: it truncates. Run it once, by hand,
against a new environment:

```bash
npx prisma db seed
```

The seed also performs an initial metric rollup, so dashboards have data
immediately rather than after the first scheduler tick.

## Environment variables

| Variable | Set by | Notes |
|---|---|---|
| `DATABASE_URL` | Blueprint, from the managed database | — |
| `NODE_ENV` | Blueprint (`production`) | Makes session cookies `secure` |
| `SESSION_COOKIE_NAME` | Blueprint | — |
| `SESSION_TTL_HOURS` | Blueprint (`12`) | — |
| `GEMINI_API_KEY` | **Dashboard, `sync: false`** | Never committed. Absent ⇒ deterministic narration |
| `GEMINI_MODEL` | Blueprint | `gemini-2.0-flash` |
| `ROLLUP_INTERVAL_MINUTES` | Blueprint (`60`) | Tunable without a code deploy |
| `ROLLUP_WINDOW_DAYS` | Blueprint (`3`) | Trailing recompute window |
| `RATE_LIMIT_LOGIN_IP` | Optional | Defaults to 30 per 5 min |
| `RATE_LIMIT_LOGIN_EMAIL` | Optional | Defaults to 10 per 5 min |

## Health check

`GET /api/health` — unauthenticated (Render probes without credentials), and
returns only whether the database is reachable. It runs `SELECT 1` rather than
returning a static `ok`, because a process that is up but cannot reach Postgres
is not healthy. It deliberately discloses no counts or tenant names; a health
endpoint is an unauthenticated surface.

## Post-deploy checklist

Section 4's required test, as concrete steps:

1. Deploy — confirm the build succeeds and `migrate deploy` reports applied migrations.
2. `GET /api/health` returns `{"status":"ok"}`.
3. Run `npx prisma db seed` once against the new database.
4. Sign in at `/login` as `admin@example.edu`. The admin dashboard shows
   non-zero capacity — the seed's rollup already ran.
5. Create a university through `/admin/universities/new`, add a manager, sign in
   as them, add an instructor. No database access needed at any point.
6. Wait one `ROLLUP_INTERVAL_MINUTES`, then check `GET /api/admin/rollup`: a run
   with `trigger: "SCHEDULED"` and `status: "COMPLETED"` confirms the timer
   fires in the deployed environment as it does locally.
7. If `GEMINI_API_KEY` is set, generate insights and confirm the text is
   model-written; unset it and confirm insights still generate with
   deterministic wording.
