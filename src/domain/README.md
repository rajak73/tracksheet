# `src/domain` — the rules, and nothing else

The definitions the product argues about. Not UI, not HTTP, not storage: the
answers to "what counts as an hour of work" and "what does one row of the
client's report say".

## Why this exists

These rules used to live in the UI folder — `_lib/student-facing.ts` and
`_components/sheet-rollup.ts` — because that is where they were first needed.
Seventeen files ended up importing the first of them, including two under
`src/server`, so the backend depended on the frontend to know what an hour was.

That was not merely untidy. Three defects in one day traced back to the same
cause — the rule was written down in more than one place, or in a place that
made it easy to reimplement rather than import:

- `rollUp` grouped hours by category and let one countable deliverable make a
  whole category countable. The same entries totalled 08h 00m by day, 13h 45m
  by week and 18h 45m by month.
- The tracker's query dropped every entry with no deliverable, so the category
  fallback could never fire for it: three lectures, 12h 45m, missing from the
  client's own sheet with nothing on screen to say so.
- `roster.ts` published the analytics engine's every-recorded-minute figure
  under the name "Working hours", and the manager list, the instructor
  directory and the CSV export all read it.

A rule with one home cannot disagree with itself.

## The dependency direction

```
    src/domain          knows about nothing
        ↑
    src/server          domain + database + HTTP plumbing
        ↑
    src/app/api         request in, response out
        ↑
    src/app/**          screens
```

Arrows point at what a layer may import. `src/domain` imports **nothing** from
`src/app` or `src/server` — that is what makes it usable from both a route
handler and a React component, and it is enforced by `no-restricted-imports` in
`eslint.config.mjs` rather than left to memory.

## What belongs here

A rule belongs in `src/domain` when both of these are true:

1. **Both sides need it.** A route handler and a component both have to give
   the same answer. Working Hours is the example: the admin network endpoint
   adds it up on the server, the instructor's sheet adds it up in the browser,
   and they must agree to the minute.
2. **It is a decision, not a mechanism.** "An hour counts when it was spent
   with students" is a decision the client made. "Fetch rows where workDate is
   between these two dates" is a mechanism, and belongs in `src/server`.

Formatting is a near miss worth naming: `formatHours` renders `01h 30m` and is
a presentation concern, so it stays in `src/app/_lib/format.ts`. The rule about
*which* hours to add up is here; the rule about how to *print* them is not.

## What is here

| file | the rule |
|---|---|
| `working-hours.ts` | Which hours count as Working Hours — the deliverable decides when there is one, the category decides when there is not |
| `rollup.ts` | How a set of activities becomes one row of the client's report |
