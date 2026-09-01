# Extraction — what is checked, and why

The model is asked what a day's text says. It is not asked to count. The one thing it
must never do is produce a number the text does not contain, because a number in a
report is read as a measurement, and a measurement nobody made is worse than none.

These checks decide whether a model's output is kept. They are pure functions over the
extraction and the day's own text — [`src/server/insights/extraction-checks.ts`](src/server/insights/extraction-checks.ts).
Nothing in that module calls a model.

`T` is the day's recorded `working_hours`. `S` is the sum of `hours` across extracted
activities.

---

## 1. Digit provenance — by proximity

Every non-null `sessions` and `hours` must appear **near its own activity**, not merely
somewhere in the day.

1. Segment the source text — `deliverable` and `deliverable_quantity` — on `;`, `,`,
   `.` and newlines. A full stop **between digits** is a decimal point, not a
   separator: splitting `1.5 hours` would invent a `1` and a `5` the text never stated.
2. For each extracted activity, find the segment or segments whose text overlaps the
   activity's `label`, on the same meaningful-word basis check 5 uses.
3. A number passes only if it appears in one of those segments.
4. If a label matches no segment, provenance **fails** for any non-null number on it. A
   null is still fine — a null states nothing and so has nothing to prove.

Inside a segment, a number matches:

- as digits, with or without a trailing `.0` — `6` matches `6.0`
- as a written form, `one` through `twelve`, case-insensitive
- a decimal only as a decimal — `1.5` is not matched by a `1` and a `5` appearing
  separately, and `1` is not matched by the `1` inside `1.5`

Numbers are **not** meaningful words for step 2. If they were, an activity labelled
`5 classes` would match the segment holding the `5` *because of* the `5` — the number
would be its own evidence.

### Why this replaced presence-anywhere

Presence passes for any number against any activity as soon as a day holds more than
one. The migrated rows made it visible: a day whose quantity read `3, 25, 1, 1, 6`
vouched for all five numbers against all six activities. Pairing each migrated activity
with its own quantity narrowed that; it did not close it. An instructor writing
`3 classes, doubt session, 2 reviews` presents the same shape by hand.

### The consequence, stated rather than softened

Where the pairing is positional across the two boxes — `Live Class, Doubt clearing`
beside `2 classes taken, 1 doubt session` — the words may not overlap, and provenance
fails. That is the check working. The only evidence that the `2` belongs to Live Class
is its position, and position is what this check exists to stop trusting. The day falls
back to its raw text, which is the conservative direction to fail in.

## 2. No over-allocation

`S <= T + 0.01`. Text attributing more hours than the day recorded is wrong — either it
double-counted an activity or it invented hours.

## 3. Reconciliation

`unallocated_hours = T - S`, to two decimals. Cannot fail.

`S = 0` is valid and common: the instructor named activities without stating per-activity
hours, so the whole day is unallocated. **Not a failure. Never retried.**

## 4. Coverage

At least one activity, and every `label` non-empty after trimming.

## 5. No fabricated activities

Every `label` shares at least one meaningful word with the `deliverable` text, compared
case-insensitively after stripping punctuation, ignoring `and the for with on of to a in`.

---

## Grouping — the `unit` field

Grouping is not built yet. This is written down now because the wording matters and is
easy to get wrong in exactly one way.

```
- unit is a short noun for what is being counted, taken from the words the instructor
  used for this activity. If their wording suggests no natural noun, use "entries".
```

It must NOT read `the natural noun for this work: "classes", "sessions", "meetings",
"reviews"`. That is a predefined vocabulary hiding inside a prompt string — it tells the
model what kinds of work exist before it has read anything, which is the classification
layer coming back through a door nobody was watching. The rule describes how to find the
noun; it does not supply the nouns.

The illustrative grouping example stays — `"<subject> class - loops"` and
`"<subject> class - arrays"` belong to one group — because the rule is hard to state
without one. The subject is a placeholder so the example demonstrates the rule rather
than naming a kind of work.

---

## Failure handling

Retry once. On a second failure set `status = FAILED` and render that day's raw
`deliverable` text unchanged. Never store a failed or partial extraction.

## Migrated days

Legacy days carry `source = MIGRATED`; their `deliverable` was rebuilt from the old
taxonomy's labels, not the instructor's words — see
[`prisma/migrations/20260901120000_migrated_quantity_pairing/migration.sql`](prisma/migrations/20260901120000_migrated_quantity_pairing/migration.sql).

They are **73% of the dev set**, so anything that only works for native days works for a
quarter of the data.

Their text is written as `Label — quantity; Label — quantity`, one activity per segment,
which is the shape check 1 reads best. `deliverable_quantity` is null on these days: the
old model had no day-level quantity, and concatenating per-activity counts into one would
misrepresent what was recorded.

Expect single-activity extractions with null sessions and null hours, and therefore full
unallocated hours. Once an instructor saves a migrated day themselves, its `source`
becomes `NATIVE` — the words are then theirs.

---

## Coverage map

| Requirement | Held by |
|---|---|
| 1. A number attached to the wrong activity fails | [extraction-provenance.test.ts](tests/extraction-provenance.test.ts) — test 4 |
| 1. A number attached to its own paired activity passes | same — test 5 |
| 1. A single-activity day with one number still passes | same — test 6 |
| 1. A label matching no segment fails on any stated number | same — test 7 |
| 1. `6` ↔ `6.0`; decimals only as decimals, both directions | same — "what counts as the same number" |
| 1. Written forms one–twelve; thirteen is not accepted | same |
| 1. A number cannot vouch for itself through the label | same |
| 1. A decimal point is not a sentence end | same — "segmenting the day's text" |
| 2. Over-allocation refused | same — "the other four checks still hold" |
| 3. `S = 0` leaves the day fully unallocated, and is valid | same |
| 4. An empty extraction fails | same |
| 5. An activity the text never mentions fails | same |
| Migrated pairing: three source rows → one paired string, null day quantity | [worklog-migrated-pairing.test.ts](tests/worklog-migrated-pairing.test.ts) |
| Migrated pairing: a row with no quantity leaves no separator artefact | same |
| Migrated pairing: no NATIVE day altered | same |
| A save reclaims a migrated day as NATIVE | same |
| No category field, category name, or evaluative flag in a response | [no-category-in-responses.test.ts](tests/no-category-in-responses.test.ts) |
| No response says `Unclassified` or `Watch` | same |
| A day is the row: saved, quantity verbatim, hours summed once | [worklog-day-row.test.ts](tests/worklog-day-row.test.ts) |
| `missing` and `future` never collapse into one empty row | same |
| The provenance note is per row, and follows the words | same |
| Delete removes the day and its `DayExtraction`, idempotently | [worklog-day-delete.test.ts](tests/worklog-day-delete.test.ts) |
| Delete leaves `ai_insight_cache` alone | same |
| No per-activity edit or delete route is reachable | same |
| The insight column never generates by rendering | [insight-viewer-gate.test.ts](tests/insight-viewer-gate.test.ts) |

### Not covered yet

Extraction itself, grouping, and every generation call. They land on a base where writes,
reads and tests agree on one table.

Three `test.todo`s name gaps that are real today rather than merely unbuilt:

- **The manager's three views**, compared against the instructor's — suspended in
  [worklog-cross-view.test.ts](tests/worklog-cross-view.test.ts) because the two sides
  read different tables, so the comparison could pass by coincidence.
- **Stored summaries go stale.** `recomputeDay` summarises `ActivityLog`, and a day
  written through `/worklog/entry` never touches it. Named in
  [metric-staleness.test.ts](tests/metric-staleness.test.ts).
- **Item 22 across the rest of the surface** — the manager's and admin's sheets and the
  CSV export still answer with the taxonomy.
