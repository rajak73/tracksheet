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

## Node version and dependency installation

Node is pinned in two places that must agree: `engines` in
[package.json](package.json) states the supported range (`>=20.9.0 <25` — Next
16.3's floor, and the majors the suite is verified on), and `NODE_VERSION` in
[render.yaml](render.yaml) pins the deployed runtime to `24.11.1`, so a redeploy
cannot silently move to a new major.

**The build must install devDependencies, and the blueprint says so explicitly:**

```bash
npm ci --include=dev && npx prisma generate && npm run build
```

`--include=dev` is load-bearing. `NODE_ENV=production` is set on the service, and
npm reads that as `omit=dev` — a plain `npm ci` would skip devDependencies, and
`next build` then fails because PostCSS cannot resolve `@tailwindcss/postcss`.
Verify it yourself with `NODE_ENV=production npm config get omit`, which prints
`dev`.

Two packages are deliberately **not** devDependencies, because an operator needs
them on the host after the build:

| Package | Needed by | Why it is a runtime dependency |
|---|---|---|
| `dotenv` | `npx prisma migrate deploy` | [prisma.config.ts](prisma.config.ts) imports it, and the prisma CLI loads that config on every invocation |
| `tsx` | `npm run admin:create` | the first-administrator command runs a TypeScript file directly |

Build-only tools — `typescript`, `tailwindcss`, `@tailwindcss/postcss`, `eslint`,
`vitest` — stay in devDependencies where they belong.

## Migrations

`preDeployCommand: npx prisma migrate deploy` — runs **before** the new instance
serves traffic, so the schema is never behind the code expecting it. No manual
step. Never `migrate dev`, never `db push`, never `db seed`.

## The first administrator

A freshly migrated database has no accounts, so nobody can sign in — and every
provisioning route requires an authenticated ADMIN. One command closes that gap,
and it is the **only** supported way to create the first production account:

```bash
npm run admin:create -- --email you@org.com --name "Your Name"
```

Run it once, by hand, against the intended production `DATABASE_URL`. It is a
one-time bootstrap operation; everything after it happens through the
application.

What it does:

- **Interactive.** The password is prompted for, never passed as an argument, so
  it does not reach shell history, `ps` output, or CI logs. Echo is suppressed
  while typing, and the value is asked for twice and compared.
- **Minimum 12 characters**, the same floor the provisioning routes enforce.
- **Hashed with the application's existing scrypt implementation** — the same
  `hashPassword` every other account uses. The plaintext is never stored,
  logged, or returned.
- **Deletes nothing.** No code path removes or modifies an existing row.
- **Refuses if the database already has an ADMIN**, so it cannot be used to
  quietly mint a second global account. Create further admins through the
  application.
- **Refuses a duplicate email**, backed by the unique index on `User.email`.
- **Not an HTTP endpoint.** There is no public bootstrap route to defend, and
  the module is imported by nothing the server loads at startup.

It prints the target host and database before prompting — check that line is the
database you meant before typing anything.

## PRISMA SEED MUST NEVER BE RUN AGAINST PRODUCTION

`npx prisma db seed` and `npx prisma migrate reset` are **development and test
commands only**. Neither belongs anywhere near a production database:

- The seed opens with fourteen unconditional `deleteMany()` calls — sessions,
  users, universities, activity logs, deliverables, audit logs, every tenant
  table. There is no `NODE_ENV` guard and no confirmation prompt. Running it
  against production destroys the data.
- It installs a **development credential that is committed to this repository**
  and prints it to stdout. Any account it creates is publicly known.

`npm run db:reset` wraps `prisma migrate reset`, which drops and recreates the
schema. Same rule: local and test databases only.

Use `admin:create` for production. Use the seed for local development, where
losing the data is the point.

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

## Login rate limiting and the trusted-proxy question

Two limiters guard `/api/auth/login`, and they are not equally trustworthy.

**The per-email limiter is sound.** It keys off the submitted address, which the
attacker cannot launder, and caps attempts against any single account
(`RATE_LIMIT_LOGIN_EMAIL`, default 10 per 5 minutes). This is the control that
actually stops password guessing against a known user.

**The per-IP limiter is best-effort.** `clientAddress()` in
[rate-limit.ts](src/server/http/rate-limit.ts) reads the first entry of
`X-Forwarded-For`. Behind a proxy that *overwrites* that header, the first entry
is the real client. Behind one that *appends*, the first entry is whatever the
client sent — so an attacker who rotates the header gets a fresh budget each
request. The code cannot tell the two cases apart, and neither can this
repository: it depends on the platform in front of the app.

Do not treat the per-IP number as a security boundary until you have confirmed,
against the platform actually in use, which end of the chain it controls:

- If the proxy **overwrites** `X-Forwarded-For`, the current code is correct.
- If it **appends**, the trustworthy value is the *last* entry, or a
  platform-specific header, and `clientAddress()` must be changed to read that —
  along with the hop count, since a fixed index is only right for a fixed
  topology.
- Do not "fix" this by guessing. Reading the wrong end either leaves the bypass
  open or collapses every user behind the proxy into one bucket, which locks out
  legitimate traffic.

Until that is confirmed, rely on the per-email limit, and treat the per-IP limit
as noise reduction rather than protection.

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
3. Create the first administrator, once, against the production database:
   `npm run admin:create -- --email you@org.com --name "Your Name"`.
   Do **not** seed. See the section above.
4. Sign in at `/login` with that account. The dashboards are empty at this
   point, which is correct — a new deployment has no tenants yet, and step 5
   creates the first one.
5. Create a university through `/admin/universities/new`, add a manager, sign in
   as them, add an instructor. No database access needed at any point.
6. Wait one `ROLLUP_INTERVAL_MINUTES`, then check `GET /api/admin/rollup`: a run
   with `trigger: "SCHEDULED"` and `status: "COMPLETED"` confirms the timer
   fires in the deployed environment as it does locally.
7. If `GEMINI_API_KEY` is set, generate insights and confirm the text is
   model-written; unset it and confirm insights still generate with
   deterministic wording.
