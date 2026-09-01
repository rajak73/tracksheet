# NIAT — University Workforce Intelligence Platform

One web application, one login page. After authenticating, the session's role
decides which dashboard renders. API routes are shared across roles; the
response differs only because the backend scopes it.

**Current state: Phase 12 complete — NIAT visual identity and design
system.** The product-facing brand is NIAT; the repository, package name,
session cookie, and database/container names are unchanged (infrastructure
identifiers, not UI). See [DESIGN.md](DESIGN.md) for the full design system —
colour tokens, typography, the role-based information-density model, and the
rationale for the palette. Phase 11 (UI/UX polish pass) is the design system
this phase refined, not replaced.

**Since then: a production-hardening pass.** AI narration is now gated by a
deterministic validator before it ever reaches a user (see "AI insights"
below); six list-returning endpoints are server-side paginated, with a
Pagination control wired into the frontend for five of the six (the exception
and its reason are in "Pagination" below); the admin overview's per-university
N+1 was batched into grouped queries; and three indexes were added on real
`EXPLAIN ANALYZE` evidence rather than because a column happened to be
queried. See "Pagination" below for the endpoint contract and the measured
numbers.

For the current verified state — including what is *not* verified and the open
defects — read [VERIFICATION-REPORT.md](VERIFICATION-REPORT.md), which is the
authoritative status document. This README describes how the system is built;
that one records what has actually been proven about it.

Ships as a **container** ([Dockerfile](Dockerfile)), currently on Northflank;
[render.yaml](render.yaml) describes the same deployment on Render. **Single
instance** either way — that is a correctness requirement, not a cost choice.
Two processes each run their own login rate limiter, so an attacker gets twice
the attempt budget. See [DEPLOYMENT.md](DEPLOYMENT.md).

Migrations and reference data run in the container entrypoint, before the
server accepts a request, so the schema is never behind the code that expects
it. A failure exits the container rather than serving against a database the
code does not match.
See [DATABASE-ARCHITECTURE.md](DATABASE-ARCHITECTURE.md) for the schema, index
strategy, aggregation design and measured query plans, and
[VERIFICATION-REPORT.md](VERIFICATION-REPORT.md) for what has been verified,
what has not, and the open defects.

## Known gaps

Schedules, breaks, workload targets, deliverable progress logging and admin
write endpoints **are** built — an earlier revision of this section listed them
as missing and was out of date. Schedule specifically is built but only
*partially* verified: slot creation has no overlap check and an invalid
`courseId` returns a 500. See [VERIFICATION-REPORT.md](VERIFICATION-REPORT.md)
§6.

The two entries below are the deliberate product decisions. They are **not** the
complete list of everything absent — [VERIFICATION-REPORT.md](VERIFICATION-REPORT.md)
§14 is authoritative for that, and §15 lists the open defects.

- **Native `.xlsx` and PDF export.** CSV only; both need a document library.
- **Activity edit and delete.** *Not implemented because it is not part of the
  confirmed business requirements.* `ActivityLog` is an append-only event
  ledger by design: it carries `createdBy`, `source` and `updatedAt` but
  deliberately has **no `deletedAt`**, while six entity models (`User`,
  `University`, `Deliverable`, `Department`, `Program`, `Course`) do carry
  it — soft delete was applied selectively to entities, not to events. No
  requirement document asks for amending a recorded activity.

  This is a **product decision, not an oversight**, and it has a real
  consequence worth surfacing: an instructor who mistypes a time cannot
  correct it, and a manager cannot remove an erroneous record. If correcting
  recorded activity becomes a requirement, the shape is already scoped —
  `logActivity` accepts an `excludeActivityId` so an edit can re-run the
  overlap check against every *other* activity without conflicting with
  itself, and soft delete would need `deletedAt`/`deletedBy`/`deletionReason`
  plus exclusion from the analytics engine, rollup, reports and AI metrics
  while remaining visible to audit. Until that requirement exists, none of it
  is built.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 16 (App Router, TypeScript), one deployable |
| API | Route Handlers — real HTTP endpoints, reachable by `curl` |
| DB | PostgreSQL 16 (Docker) |
| ORM | Prisma 7 with the `pg` adapter |
| Auth | Server-side sessions, httpOnly cookie, scrypt password hashing |
| Tests | Vitest driving raw HTTP against a running server |

## Setup — local development only

Every command in this section is for a local or test database. `db:seed` and
`db:reset` are destructive and carry development credentials; see
[Production deployment](#production-deployment) for how a real environment is
brought up instead.

```bash
npm install
npm run db:up        # starts postgres (dev :5433, test :5434)
npm run db:migrate   # applies migrations
npm run db:seed      # LOCAL ONLY — wipes every table, then seeds 2 universities,
                     # 1 admin, 2 managers, 4 instructors
npm run dev
```

The test database runs on tmpfs and is disposable; the dev database persists in
a named volume.

### Seeded accounts — development only

These accounts exist only on a seeded local or test database, and their password
is committed to this repository. They must never exist in production; the seed
that creates them must never be run there.

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
11. **No name a user typed reaches a model.** People are replaced with
   positional labels before the prompt is built and restored after the reply is
   verified — see [pseudonyms.ts](src/server/ai/pseudonyms.ts). Display names
   are self-editable, so without this an instructor could write instructions
   into their manager's brief.
12. **The rules live in `src/domain`, and the direction is enforced.**
   `domain ← server ← app/api ← app`; a `no-restricted-imports` rule in
   [eslint.config.mjs](eslint.config.mjs) fails the build if `src/server` or
   `src/domain` reaches into `src/app`. See
   [src/domain/README.md](src/domain/README.md) for what belongs there and
   why it exists.

## AI insights — how the cache works

An insight is a short summary of what a period was spent on. It is generated **at
most once per distinct state of the underlying work logs**, and only when
somebody actually opens the view. There is no background job, no pre-warming and
nothing on write: a period nobody looks at is never paid for.

### What decides a regeneration

```
context_hash = SHA256( canonical_json + "|" + prompt_version + "|" + model_id )
```

One comparison decides everything. If the stored hash equals the current one the
stored insight is returned and **no provider call is made** — no AI client is
even constructed on that path.

Invalidation is **content-based only**. There is no TTL, deliberately: an insight
that still matches its data is still correct however old it is, and one that no
longer matches is wrong however fresh.

Nothing cascades. Editing one day changes that day's hash, and also the week's
and the month's, because their contexts *contain* that day's rows. An untouched
neighbouring day is unaffected. There is no cascade code and there must not be —
it would be a second description of a relationship the data already has.

### `prompt_version` — one per scope

Three hand-incremented constants in `src/server/insights/context.ts`:

```
PROMPT_VERSION_DAY   = "day_v1"
PROMPT_VERSION_WEEK  = "week_v1"
PROMPT_VERSION_MONTH = "month_v1"
```

Each is part of **its own scope's** hash, so editing the week prompt invalidates
cached weeks and leaves every cached day and month alone. One shared version
would have thrown all three away for a change to one.

**Increment when** the wording, the instruction, the output shape or the meaning
of that scope's insight changes — anything that could make the model answer
differently for identical data.

**Do not increment** for a refactor that leaves the sent text byte-identical.

`model_id` is read from `GEMINI_MODEL` rather than pinned, so switching models
invalidates by the same mechanism.

### Canonicalisation rules

The canonical context is built by `buildCanonicalContext`, and the **same value**
is both hashed and sent to the model. Nothing else may assemble a prompt from the
rows — if the hashed bytes and the sent bytes could differ, the cache would be
claiming an insight came from data it never saw.

| Rule | Why |
|---|---|
| **Allowlist**: `log_date`, `activities[].{label, quantity, hours}`, `remarks`, `status` | Only these can change what an insight says |
| **Excluded**: `id`, `user_id`, `total_hours`, `createdAt`, `updatedAt`, DB and array order | None can change the answer; all would throw the cache away |
| `total_hours` excluded specifically | It is *derived*. A stale cache column must not be able to invalidate anything |
| Sort days by date; activities within a day by label | Order is not a property of the data — a reordered array says the same thing |
| Unicode NFC | Two spellings of one character are one character |
| Trim, and collapse internal whitespace (newlines included) | Re-typing with a line break elsewhere says the same thing |
| `null` and `""` are one value, emitted as `null` | "Wrote nothing" told two ways |
| Dates `YYYY-MM-DD`, numbers to 2 decimals | Fixed forms, so formatting cannot move the hash |
| **`quantity` is normalised as TEXT** | It is free text and never coerced to a number here — see below |
| **Casing preserved** | "OAuth" and "oauth" are not the same word to a reader |
| JSON, keys sorted at every level, no insignificant whitespace | `JSON.stringify` preserves insertion order, which is incidental |

A canonicalisation bug is silent — everything still works, it just costs. The
hit/miss counters (`insightCacheCounters()`) and the per-request `[insight]` log
line are how that is caught.

### `quantity` is free text, and counting it is all-or-nothing

The instructor writes whatever describes the work: `"5 class"`, `"2 batches"`,
`"half day"`, `"3 sections + lab"`, or nothing. It is stored verbatim and shown
verbatim. It is context, not a measurement — `hours` is the only reliable numeric
field on an activity.

Counts are extracted **in code**, never by the model, with one strict pattern:

```
^\s*(\d+(?:\.\d+)?)\b
```

- Match → use the number.
- Null or empty → counts as `1`; the activity still happened.
- Anything else → **extraction fails for that member.**

If *any* member of a group fails, the whole group gets `count: null` and
`count_confident: false`. No partial sums, and never the item count dressed up as
a count. A group where one activity says `"3 classes"` and another says `"as per
timetable"` has no honest total, so it gets none.

Three regressions this prevents, all of which produce a number that *looks*
right:

1. Counting rows instead of summing quantities — three activities saying
   `"2 classes"`, `"2 classes"`, `"3 classes"` are **7**, not 3.
2. Partially summing a group with an unreadable member.
3. Falling back to `item_count` when extraction fails.

`total_units` is only reported when **every** group is confident.

### Failure behaviour

A failed generation may never destroy a good answer. The previous insight keeps
its payload, its snapshot and its hash; only `failureCount` and `lastError` move,
and the stale insight is served with `is_stale: true`. After **three consecutive
failures** the view stops trying on its own and offers a manual retry — a broken
provider retried once per page load is a bill, not a retry. Any success resets
the count.

Two people opening the same period at once take a `pg_advisory_xact_lock` on the
scope key, so they make **one** call between them. It is a database lock, not an
in-memory one, because the app runs more than one instance.

## Working Hours

The figure the client's report is read for, and the one number every screen has
to agree on.

**Working Hours is time spent WITH STUDENTS.** Lectures, practice sessions,
exams, mentoring, student support. Preparation, meetings, reporting, admin,
research and an instructor's own learning are all real work and are all
recorded — they appear on the sheet with their hours, muted — but they are not
what this figure measures.

The rule is one function,
[`countsAsWorkingHours`](src/domain/working-hours.ts): an entry's
**deliverable** decides when it has one, and its **category** decides when it
does not. That fallback is load-bearing rather than defensive — the manual
entry route cannot attach a deliverable at all, so without it real teaching
hours vanish from the report with nothing on screen to say so.

Three figures exist and are deliberately different. Confusing them has caused
real defects, so they are named apart:

| figure | what it counts | where |
|---|---|---|
| **Working Hours** | time with students | `src/domain/working-hours.ts` |
| **Recorded hours** | every recorded minute except `UNUTILIZED` | analytics engine, `productiveHours` |
| **Deliverable hours** | hours on entries that name a deliverable | tracker, reporting detail only |

They are never added together and never reconciled. The Deliverable column on
the sheet deliberately does not sum to Working Hours, and the muted lines are
what says so.

## The model is called once, and never again

**The rule.** Gemini is called at exactly one moment: when an instructor's raw
text becomes structured `ActivityLog` rows. Every number after that — today's
hours, this week's, this month's, a comparison between two of them, any total
on any dashboard, report or export — is arithmetic over the stored rows.

**Why it is not negotiable.** A figure that comes from a query can be
reconciled, reproduced and argued with. A figure that comes from asking a model
to look at the data again cannot, and nothing about it looks different. The
client reconciles this sheet by hand against a timetable; the moment a total
stops being checkable, the product stops being worth having.

### What may call the model

Two things, and nothing else:

1. **Parsing raw text that has not been parsed** — a new submission, or an
   explicit re-parse of one that failed. This is the only place free text
   becomes data.
2. **Phrasing a fact that deterministic code has already established** —
   narration. Even here the boundary is strict: `detectAnomalies` decides
   whether a condition holds, by arithmetic, with the provider untouched; the
   model is only ever handed an already-detected fact to word. Every condition
   also has a deterministic sentence, so an outage costs wording and never a
   missed condition.

### What may never call it

Anything that produces a number. If a figure can come from a `SUM`, a
`GROUP BY` or a join against the taxonomy, it comes from there. A feature that
would ask the model to work out a total or a trend already derivable from
stored rows is wrong at the proposal stage, not at review.

No numeric query is ever cached in a way that could disagree with the database.
The same query run twice reads live both times. (Distinct from caching a
narrated *sentence*, which exists to avoid re-phrasing unchanged prose — the
figures beside it are always recomputed.)

### It is checked, not trusted

`geminiCallCount()` counts every request that leaves the process, and
[`tests/no-gemini-in-arithmetic.test.ts`](tests/no-gemini-in-arithmetic.test.ts)
runs the real calculation paths — the six views' row builder, the roll-up, the
analytics engine, the month spreadsheet and its CSV, and condition detection —
asserting the count does not move.

That guard immediately found one: the instructor's report was fetching
`/worklog/summary` on every view and discarding the answer, so opening a screen
paid for a model call that changed nothing. The figures were all correct, which
is exactly why it had survived review.

It runs on every `npm test` — no flag, no separate invocation — and it has been
proved to trip rather than merely to read zero: the violation above was
deliberately reintroduced and the assertion failed with `expected 1 to be +0`.

### Adding a calculation path

The guard covers the surfaces that existed when the rule was written. It cannot
cover code that does not exist yet, so this is a standing requirement rather
than a finished checklist:

> **If you add a report, dashboard, export or aggregation, add its zero-call
> assertion to `tests/no-gemini-in-arithmetic.test.ts` before the feature is
> done.**

The pattern is three lines:

```ts
const before = geminiCallCount();
await theNewThing(...);          // with real stored rows, not a stub
expect(geminiCallCount()).toBe(before);
```

Exercise it against real rows rather than a fixture array. The bug this guard
caught was not inside a calculation — it was a fetch sitting beside one, and
only a path run end to end would have reached it.

The guard is part of the pre-commit gate below, so a change that breaks this
rule is stopped before it is committed.

## Timezones

**Every day boundary is the university's, and nothing depends on the server's
own clock zone.** A worklog is refused unless it is for the instructor's current
local day; a week runs Monday to Sunday in their zone; a rollup covers their
days. The machine could be in UTC, IST, or anywhere.

The primitives are in [`workday.ts`](src/server/time/workday.ts) —
`workDateFor(instant, timeZone)` turns an instant into a calendar date,
`zonedToUtc` goes back the other way through DST. Every "now → date" on the
server routes through them. On the client, `todayIn(timeZone)` answers in the
university's zone; `todayISO()` answers in the *browser's* and is only correct
where the two agree.

| where | source of "today" |
|---|---|
| server request paths | `workDateFor(new Date(), config.timezone)` |
| the rollup scheduler | UTC, padded a day each side to cover every zone |
| client screens | `todayIn(zone)`, zone from `/api/auth/me` |
| stored `@db.Date` columns | midnight UTC; read back with `toISOString()` |

### Two rules, and how they are enforced

**Never hardcode a zone.** The deployment is Indian and the rules are not. The
rollup window is padded by a day rather than by five and a half hours, because
one day covers UTC−12 through UTC+14 and IST covers only IST.

**Never read the machine's clock zone.** `getHours()`, `getMonth()` and their
siblings answer in whatever zone the process happens to be running in.
[`tests/timezone-boundaries.test.ts`](tests/timezone-boundaries.test.ts) fails
the build if one appears under `src/server` or `src/domain`, and sweeps all
twenty-four hours across five zones — Kolkata, New York, Kiritimati (+14),
Midway (−11) and UTC — so a fix that only works at +05:30 fails there.

That matters because this bug class is invisible for most of a day. The one
that started this audit passed for eighteen and a half hours out of twenty-four
and was found only because somebody happened to be working at 01:42.

## The commit gate

A pre-commit hook runs before every commit and blocks it on failure. It is
installed by `npm install` on a fresh clone — the `prepare` script points
`core.hooksPath` at the versioned `.githooks/` directory, so the hook is
reviewable in the repository rather than living unversioned in `.git/hooks`.

No dependency was added for this. Husky's value is exactly the `prepare` line
above, and that line is three words of git config.

### What runs, and why not everything

| step | scope | time |
|---|---|---|
| `tsc --noEmit` | the whole repository | ~2s |
| `eslint --max-warnings=0` | the staged files only | ~3s |
| `npm run test:gate` | 130 tests across 6 files | ~24s |

`--max-warnings=0` is load-bearing rather than pedantry: this project's
unused-variable rule is a *warning*, and eslint exits 0 on warnings, so without
it the lint step printed the problem and let the commit through. That was found
by testing the hook rather than trusting it — a deliberate unused constant was
committed while the gate reported "passed".

About thirty seconds. **The full suite is five to eight minutes**, and a gate
that costs that much on every commit is one people learn to pass with
`--no-verify` — a bypassed gate protects nothing. So the hook runs the checks
that catch the regressions this project has actually suffered, and the full
suite stays the standard before deploying.

`test:gate` is:

- `phase1-tenant-isolation` and `phase9-instructor-isolation` — one university
  reading another's data, or one instructor reading a colleague's, is the worst
  thing this system could do.
- `no-gemini-in-arithmetic` — the model is called once and never again.
- `worklog-taxonomy-decisions` — the five classification decisions.
- `worklog-report-format` — the client's cell format, including `?` for a count
  nobody stated.
- `worklog-views` — the shared row builder both roles depend on.

### Bypassing it

`git commit --no-verify` skips the hook. Git provides that and it cannot be
removed, but it should be rare and deliberate — a broken build committed with
`--no-verify` is indistinguishable from one committed by a gate that was never
there. If the hook is in the way often, the subset is wrong and should be
changed rather than routed around.

### One thing it does not check

The hook runs against the **working tree, not the index**. Stage some files,
leave others modified, and it tests everything on disk rather than what is
about to be committed. Stashing the difference inside a hook is the usual fix
and a well-known way to lose work, so it is not done — commit from a clean
tree when the distinction matters.

## The report taxonomy

The client's report is written in a closed vocabulary of **8 categories and 25
deliverables**, defined once in
[`src/domain/worklog-taxonomy.ts`](src/domain/worklog-taxonomy.ts). That one
list is simultaneously the vocabulary offered to the model, the allow-list its
reply is checked against, and the names the report prints — because three lists
that must agree are three lists that eventually will not, in a column the
client reconciles by hand.

It is **not** the database taxonomy. `ActivityType` and `DeliverableType` hold
11 categories and 44 deliverables, they carry foreign keys and rollups, and
they are not changing. Each report deliverable names the stored codes it prints
for, so every row traces back to what was actually recorded.

### Counting is a property of the deliverable

The unit decides what an unstated quantity means, and nothing else does:

| mode | examples | unstated count becomes |
|---|---|---|
| `occurrence` | Live Class, Department Meeting, Workshop Attended | **1** — the entry *is* one of them |
| `items` | Assignment Evaluation, Exam Evaluation, Lab Evaluation, Experiment | **`?`** — never 1, never 0 |
| `none` | Literature Review, Data Analysis, Reporting, Documentation, Department Duties | no entry in the column at all |

`ActivityLog.quantity` is nullable for this reason. Null is the client's `?`,
not missing data to be defaulted away, and deliberately not zero — zero is a
count, and "none" and "unknown" are answers a manager acts on differently.

### Instructor Category and Subjects Covered are two different fields

They were one column, and the two readings of it contradicted each other so
directly that each spec forbade the other. Never collapse them again:

| field | answers | source | absent reads as |
|---|---|---|---|
| **Instructor Category** | what this person **is** | `Instructor.categoryId`, assigned by an admin, never inferred | `Not Provided` |
| **Subjects Covered** | what they **did** this period | `ActivityLog.broadCategoryId`, judged per entry by the model | `—` |

On the instructor view and the manager Day/Week sheets both appear as columns.
On the manager month spreadsheet Instructor Category is a sticky left column —
one fixed value per person — while Subjects Covered sits inside each week's
group, because it varies week to week for the same instructor.

### Four names added after the taxonomy shipped

Each replaced a mapping that was quietly wrong, and each is recorded here
because the wrongness was invisible in the report rather than obvious:

- **Lab Evaluation** — printed as *Exam Evaluation → N Scripts*, which put lab
  marking into the exam-script total. Worse, a lab evaluation with no count
  read as a *Practical / Lab Session*, so the same work moved between
  Assessment and Teaching depending on whether a number was written.
- **Meeting (Other)** — every meeting was a *Department Meeting*, so a
  one-to-one with a student inflated a governance count.
- **Department Duties** — invigilation rosters, admissions and accreditation
  all printed as *Documentation*, none of which is a document being written.
- **Data Analysis** — analysing data landed on *Experiment*, which is
  item-counted, so it demanded a count of experiments nobody ran.

`npm run worklog:sample` puts the sentences behind each of these through the
real model and **asserts** the result, exiting non-zero if any decision stops
holding. It is a script rather than a suite test for the reason the AI
narration is: it needs a real key, and a test that silently passes without one
is worse than no test. It has already earned its keep — it caught "ran the lab
evaluation for section B" drifting back to *Practical / Lab Session* when it
appeared in the same paragraph as a counted sentence, which is the
category-moves-with-the-phrasing bug the Lab Evaluation decision exists to
remove.

### The six views

Instructor and Manager each get Day, Week and Month. All six read the same
`ActivityLog` rows and are computed by `GROUP BY` at read time — nothing is
stored pre-flattened, because a stored copy cannot survive a per-entry edit.

The merge lives once, in
[`buildPeriodRow`](src/domain/worklog-rows.ts): a Tech "Live Class" and a Maths
one become one line with their hours added, on every screen, because only one
function decides. It was two implementations, and they disagreed.

| view | rows are | ordering |
|---|---|---|
| Instructor Day | one per **day** | newest first, today labelled "Today" |
| Instructor Week | one per **day** of the week | Monday first — a calendar reads forwards |
| Instructor Month | one per **week** | the week in progress first, then descending |
| Manager Day | one per **instructor** | the roster, whoever filed and whoever did not |
| Manager Week | one per **instructor**, summed | sortable by real summed minutes |
| Manager Month | one per **instructor**, weeks across | chronological left to right — it is a spreadsheet |

**Three states, not two.** A period with nothing in it is either `missing`
(it passed and nobody filed) or `future` (it has not happened). Collapsing them
is how a week half ahead of today reads as half a week of people not filing.

**Remarks composes from two places.** A day can carry a note the instructor
wrote about the whole day (`WorklogDayNote`) and each entry carries its own
(`ActivityLog.remarks`). The day note wins where one exists — it is the more
considered of the two — and the entries' remarks stand in where none does,
de-duplicated. A period spanning days joins each day's, semicolon-separated in
date order, skipping the empty.

## Pagination

Six list-returning endpoints are server-side paginated: Universities,
Instructors, an instructor's Activities, an instructor's Deliverables, a
university's Audit Log, and a university's workload Reports (paginates
`report.rows`; `report.totals` is always computed over the whole university
regardless of which page is visible).

The shape is additive on purpose: every route keeps its existing top-level
array key (`universities`, `instructors`, ...) and adds `page`, `limit`,
`total`, `hasMore` as sibling fields, so nothing that already read the array
directly had to change. Universities and Instructors both also take `search`
(server-side `contains`, case-insensitive), but over **different fields**:
Universities matches `name`, `code` and `slug`; Instructors matches the user's
name and email, the employee code, and the university name (that last one
because the page it feeds is platform-wide). Only Universities takes
`sort`/`order` — `name`, `code` or `createdAt`, the fields that exist directly
on the model; Instructors has no sort param and keeps its fixed `createdAt`
ordering, silently ignoring a `sort` query param rather than rejecting it.

- **`page`/`limit` validate like everything else here** — malformed input is
  `400`, not a silent fallback (`parsePage`/`parseLimit` in
  [params.ts](src/server/http/params.ts)). An oversized `limit` is clamped to
  the route's own max, never honoured verbatim.
- **The frontend actually uses it.** A paginated API with no UI consuming
  `page`/`total`/`hasMore` is just a lower, silent cap — this repo's own
  `db:perf-seed` dataset (100 universities, 10,000 instructors) already
  exceeds the default page size. Seven pages, covering five of the six
  endpoints, render a shared `Pagination` control
  ([ui.tsx](src/app/_components/ui.tsx)) and reset to page 1 on
  search/filter/sort changes. Picker `<select>`s (choosing a university or
  instructor from a dropdown, not browsing a table) are bumped to
  `limit=200` instead — a click-through control inside a `<select>` isn't a
  sensible UI, and 200 is a safe ceiling at this app's realistic scale.

  **Deliverables is the sixth endpoint and has no Pagination control.** The
  instructor view deliberately raises the limit instead of paging, because it
  renders derived summary tiles (assigned/outstanding/completed/overdue)
  computed over the *whole* fetched array — paginating it would make those
  tiles silently wrong past page one. That reasoning is sound, but the
  implementation is not complete: the instructor view requests exactly
  `limit=200`, which is also the server's maximum, so a 201st deliverable is
  invisible; and the **manager view passes no limit at all**, silently
  truncating at the fallback of 50 per instructor. Both are open defects, not
  finished design — see [VERIFICATION-REPORT.md](VERIFICATION-REPORT.md) §15.
- **Indexes were added on evidence, not assumption.** The new pagination
  query shapes (`WHERE ... ORDER BY ... LIMIT ... OFFSET`) were checked
  against `EXPLAIN ANALYZE` at bulk scale (100k rows) before touching the
  schema. Three were added (and one dropped, so net +2): `ActivityLog` gained
  `(instructorId, startTime)`
  because the activities route orders by `startTime` while the existing
  index only covered `(instructorId, workDate)` — every page-one request was
  sorting the instructor's entire matching set before applying `LIMIT`,
  12.8ms → 0.07ms at 20k rows for one instructor. `Instructor`'s bare
  `(universityId)` index was replaced with `(universityId, createdAt)` plus a
  new `(createdAt)`, for the same reason on the list's default sort — 90×+
  faster, filtered and unfiltered. Every other candidate (`Deliverable`,
  `University`'s search, `AuditLog`, `LeaveRequest`, `ScheduleSlot`,
  `AiInsight`, `UniversityDailyMetric`) was measured and left alone; a
  leading-wildcard university search, for one, cannot benefit from a btree
  index regardless of what gets added to it.
- **The admin overview's N+1 was fixed the same pass.** It cost four queries
  *per university* — the classic N+1 pattern — on top of a handful of fixed
  queries that don't scale with N. Universities are now grouped by their
  resolved reporting period (almost always one group) and each group runs
  one batched query per concern instead of one per university: measured via
  Prisma's own query-event log against real seeded rows, isolating just the
  per-university portion — 3 universities: 12 → 4 queries; 10: 40 → 4; 100:
  400 → 4 queries, exactly the 4N the per-university loop predicts. Response
  shape is unchanged.

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
  ai/validate.ts           the gate between model output and the UI (§ AI insights)
  http/params.ts           shared page/limit/date query-param validation (400, not 500)
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
- **A model answering successfully is not the same as a model answering
  correctly.** [validate.ts](src/server/ai/validate.ts) sits between the model
  and the UI: every numeric and date-like token in the model's text is
  extracted and must be justified by a value the condition's own `metrics` or
  `threshold` actually produced (rounding accepted as paraphrase, never used
  to rewrite the text). This is not "does the true number appear somewhere in
  the text" — that check passes "utilisation of 44.38%, down from 61% last
  period" while missing the invented 61. A failure **discards** the narration
  rather than repairing it and falls back to the deterministic text; the
  rejected text itself is never logged, only which rule it broke.
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
- `npm run db:seed` runs an initial rollup, so a fresh *local* database has
  populated dashboards without anyone pressing a button. In production the
  dashboards populate on the first scheduler tick instead.

The periodic timer is disabled under test (`DISABLE_ROLLUP_SCHEDULER=1`) so it
cannot race the explicit rollups the tests trigger. The function it calls is
covered by the suite through the `MANUAL` and `SEED` paths; the timer wiring was
verified separately against a live server.

## Production deployment

Full runbook: [DEPLOYMENT.md](DEPLOYMENT.md). Two things matter enough to repeat
here.

**Install with dev dependencies at build time.** `NODE_ENV=production` makes npm
skip devDependencies, and the build needs `tailwindcss` / `@tailwindcss/postcss`,
so the build step is `npm ci --include=dev && npx prisma generate && npm run
build`. `dotenv` and `tsx` are real dependencies rather than dev ones, because
`prisma migrate deploy` and `admin:create` need them on the host after the build.
Node is pinned by `engines` (`>=20.9.0 <25`) and by `NODE_VERSION` in
[render.yaml](render.yaml).

**Migrate, then provision reference data.** A migrated database is not yet a
working one. `ActivityType` is global reference data — the taxonomy every
activity record points at — and without it `GET /api/activity-types` returns
`[]` and logging any activity fails with `ACTIVITY_TYPE_NOT_FOUND`:

```bash
npx prisma migrate deploy
npm run db:reference-data
```

`db:reference-data` upserts the 11 canonical activity types on their natural
key. It **deletes nothing**, is **idempotent** (safe on every deploy, not just
the first), preserves existing ids so historical activity keeps pointing at the
same types, and leaves any type it does not define untouched. It is **not**
`prisma db seed` — that command wipes fourteen tables and installs development
credentials, and must never run against production.

**Then bootstrap one administrator.** A freshly migrated
database has no accounts, and every provisioning route needs an authenticated
ADMIN, so one command creates the first one:

```bash
npm run admin:create -- --email you@org.com --name "Your Name"
```

Run once, against the intended production `DATABASE_URL`. The password is
prompted for rather than passed as an argument — echo suppressed, minimum 12
characters, hashed with the application's existing scrypt implementation. The
command deletes nothing, refuses if an ADMIN already exists, refuses a duplicate
email, and is not exposed as an HTTP endpoint. Everything after this — tenants,
managers, instructors — is created through the application.

**Never seed or reset production.** `npm run db:seed` begins with fourteen
unconditional `deleteMany()` calls and installs accounts whose password is
committed to this repository; `npm run db:reset` drops the schema. Both are
development and test commands, with no environment guard to stop them from
destroying a production database.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm test` | Full gate: isolation, config, activities, analytics, insights |
| `npm run db:up` / `db:down` | Start / stop Postgres |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Reseed — **local/test only, wipes every table** |
| `npm run db:reset` | Drop and recreate the schema — **local/test only** |
| `npm run db:reference-data` | Provision required ActivityType reference data — **idempotent, deletes nothing, production-safe** |
| `npm run admin:create` | Create the first ADMIN on a fresh database (production bootstrap) |
| `npm run db:perf-seed` | Generate a 100-university / 3.9M-activity perf dataset |
| `npm run db:drift` | Fail if migrations and schema.prisma disagree |
