/**
 * The six checks an extraction must pass before it is stored.
 *
 * ── Why an extraction is checked at all ───────────────────────────────────
 * The model is asked what a day's text says. It is not asked to count, and the
 * one thing it must never do is produce a number the text does not contain —
 * because a number in a report is read as a measurement, and a measurement
 * nobody made is worse than no measurement.
 *
 * These are pure functions over the extraction and the day's own text. Nothing
 * here calls a model; this is what decides whether a call's OUTPUT is kept.
 *
 * On failure the caller retries once, then stores `FAILED` and the day renders
 * its raw text unchanged. A failed check never produces a partial extraction.
 */

/** The units a duration can be stated in. Anything else is not a duration. */
export type DurationUnit = "hours" | "minutes";

/** One activity as the model returned it. */
export type ExtractedActivity = {
  label: string;
  /** How many of the thing. Null when the text does not say. */
  sessions: number | null;
  /**
   * How long, IN THE UNIT THE TEXT USES. Null when the text states no duration.
   *
   * ── Why not `hours` ───────────────────────────────────────────────────────
   * It was `hours`, and that field could not be filled honestly. An instructor
   * writing "checked 25 quiz papers — 45 minutes" states 45; a model asked for
   * hours has to answer 0.75, and 0.75 is nowhere in the text, so digit
   * provenance rejects it — correctly. Every line stating minutes failed, which
   * in real data is most of them.
   *
   * Reporting the number as written keeps provenance meaningful and keeps the
   * model out of arithmetic. Code converts; the model never does.
   */
  duration_value: number | null;
  duration_unit: DurationUnit | null;
};

/**
 * The duration in whole minutes, or null when none was stated.
 *
 * The only place a unit conversion happens, and it happens in code, after the
 * stated number has already been checked against the text.
 */
export function durationMinutes(activity: ExtractedActivity): number | null {
  if (activity.duration_value === null || activity.duration_unit === null) return null;
  return activity.duration_unit === "hours"
    ? Math.round(activity.duration_value * 60)
    : Math.round(activity.duration_value);
}

/** The day the extraction describes. */
export type DayText = {
  deliverable: string;
  deliverableQuantity: string | null;
  /** T — the MINUTES the instructor recorded for the day, independently. */
  workingMinutes: number;
};

export type CheckFailure = {
  /** Which of the six. Numbered as the spec numbers them. */
  check: 1 | 2 | 3 | 4 | 5 | 6;
  reason: string;
};

export type CheckResult =
  | { ok: true; unallocatedMinutes: number }
  | { ok: false; failures: CheckFailure[] };

/* Ignored when deciding whether two pieces of text are about the same thing.
   The spec's list, unchanged. */
const STOPWORDS = new Set(["and", "the", "for", "with", "on", "of", "to", "a", "in"]);

const WRITTEN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * The words that can carry a match.
 *
 * ── Why numbers are not meaningful words ──────────────────────────────────
 * Check 1 uses this to decide which segments an activity's label belongs to,
 * and then looks for the activity's number in those segments. If a number
 * counted as a word, an activity labelled "5 classes" would match the segment
 * holding the 5 BECAUSE of the 5 — the check would be asking the number to
 * vouch for itself. So digits are dropped here and the overlap has to be
 * carried by an actual word.
 */
function meaningfulWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().split(/[^a-z0-9.]+/)) {
    const word = token.replace(/^[.]+|[.]+$/g, "");
    if (!word || STOPWORDS.has(word)) continue;
    if (/^\d+(\.\d+)?$/.test(word)) continue;
    out.add(word);
  }
  return out;
}

/**
 * The day's text, cut into the pieces a number could belong to.
 *
 * Split on `;`, `,`, `.` and newlines — with one exception that matters: a full
 * stop BETWEEN DIGITS is a decimal point, not a sentence end. Splitting "1.5
 * hours" into "1" and "5 hours" would invent two numbers out of one and hand
 * check 1 a `1` and a `5` that the text never contained separately.
 */
export function segments(text: string): string[] {
  return text
    .split(/[;\n,]+|(?<!\d)\.|\.(?!\d)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Every number a piece of text actually states, written or in digits. */
function numbersIn(segment: string): number[] {
  const found: number[] = [];
  for (const match of segment.matchAll(/\d+(?:\.\d+)?/g)) {
    found.push(Number(match[0]));
  }
  for (const [word, value] of Object.entries(WRITTEN)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(segment)) found.push(value);
  }
  return found;
}

/**
 * Is `target` one of the numbers this segment states?
 *
 * Compared as VALUES rather than as substrings, which is what makes the spec's
 * three rules fall out of one rule:
 *
 *   - `6` matches `6.0`, because both parse to 6.
 *   - `1.5` is not matched by a `1` and a `5` appearing separately, because
 *     neither of those parses to 1.5.
 *   - `1` is not matched by the `1` inside `1.5`, because the only number that
 *     text states is 1.5. Substring matching gets this one wrong, and it is the
 *     same disease as the rule above, pointing the other way.
 */
function states(segment: string, target: number): boolean {
  return numbersIn(segment).some((n) => Math.abs(n - target) < 1e-9);
}

/**
 * Check 1 — digit provenance, by PROXIMITY.
 *
 * ── What this used to be, and why presence was not enough ─────────────────
 * It used to ask whether a number appeared ANYWHERE in the day's text. That
 * passes for any number against any activity as soon as a day holds more than
 * one of them. The migrated rows made it obvious — a day whose quantity read
 * "3, 25, 1, 1, 6" would vouch for all five numbers against all six activities
 * — but the pairing fix does not close the hole, it only narrows it. An
 * instructor writing "3 classes, doubt session, 2 reviews" presents exactly the
 * same shape: several numbers in one string, and presence alone cannot say
 * which belongs to what.
 *
 * So a number must now appear NEAR its own activity: in a segment of the text
 * that the activity's label actually overlaps.
 *
 * ── The consequence, stated rather than softened ──────────────────────────
 * Where the pairing is positional across the two boxes — "Live Class, Doubt
 * clearing" beside "2 classes taken, 1 doubt session" — the words may not
 * overlap, and provenance fails. That is the check working: the only evidence
 * that the 2 belongs to Live Class is its POSITION, and position is precisely
 * what this check exists to stop trusting. The day falls back to its raw text,
 * which is the conservative direction to fail in.
 */
function checkProvenance(activities: ExtractedActivity[], day: DayText): CheckFailure[] {
  const source = [day.deliverable, day.deliverableQuantity ?? ""].filter(Boolean).join("\n");
  const parts = segments(source).map((text) => ({ text, words: meaningfulWords(text) }));
  const failures: CheckFailure[] = [];

  for (const activity of activities) {
    const numbers: Array<[string, number]> = [];
    if (activity.sessions !== null) numbers.push(["sessions", activity.sessions]);
    /* The duration AS STATED, never the converted minutes. "45 minutes"
       converts to 45 either way, but "2 hours" converts to 120 and 120 is not in
       the text — checking the converted figure would fail every duration written
       in hours. The number the model reported is the number the text must hold. */
    if (activity.duration_value !== null) {
      numbers.push(["duration_value", activity.duration_value]);
    }
    // A null states nothing and so has nothing to prove.
    if (numbers.length === 0) continue;

    const labelWords = meaningfulWords(activity.label);
    const near = parts.filter((p) => [...p.words].some((w) => labelWords.has(w)));

    if (near.length === 0) {
      /* The label matches no segment at all, so there is no text this number
         could have come from. Note that a null would still have been fine —
         only a stated number needs somewhere to have come from. */
      for (const [field, value] of numbers) {
        failures.push({
          check: 1,
          reason: `"${activity.label}" matches no segment of the day's text, so ${field} ${value} has no source`,
        });
      }
      continue;
    }

    for (const [field, value] of numbers) {
      if (!near.some((p) => states(p.text, value))) {
        failures.push({
          check: 1,
          reason: `${field} ${value} does not appear near "${activity.label}" (looked in: ${near
            .map((p) => `"${p.text}"`)
            .join(", ")})`,
        });
      }
    }
  }
  return failures;
}

/**
 * Check 6 — distinct occurrence.
 *
 * ── The hole check 1 leaves open ──────────────────────────────────────────
 * Check 1 asks whether each number APPEARS near its activity. Ask that of a
 * line reading "Doubt solving session - 1 hour" and an extraction claiming
 * `sessions: 1` and `duration_value: 1` passes twice over — the same single `1`
 * vouches for both fields. The text says one hour. It does not say one session,
 * and nothing in check 1 can tell the difference.
 *
 * So every stated number must map to its OWN occurrence. Two fields wanting the
 * same value need the text to state that value twice.
 *
 * Implemented by consuming occurrences: the numbers in the matched segments are
 * collected WITH their multiplicity, and each field removes one. A field left
 * with nothing to take is a field the text does not separately support.
 */
function checkDistinctOccurrence(activities: ExtractedActivity[], day: DayText): CheckFailure[] {
  const source = [day.deliverable, day.deliverableQuantity ?? ""].filter(Boolean).join("\n");
  const parts = segments(source).map((text) => ({ text, words: meaningfulWords(text) }));
  const failures: CheckFailure[] = [];

  for (const activity of activities) {
    const wanted: Array<[string, number]> = [];
    if (activity.sessions !== null) wanted.push(["sessions", activity.sessions]);
    if (activity.duration_value !== null) {
      wanted.push(["duration_value", activity.duration_value]);
    }
    /* One number can never collide with itself, and none at all states nothing.
       Check 1 already covers whether a lone number is present. */
    if (wanted.length < 2) continue;

    const labelWords = meaningfulWords(activity.label);
    const near = parts.filter((p) => [...p.words].some((w) => labelWords.has(w)));
    // No segment at all is check 1's failure to report, not this one's.
    if (near.length === 0) continue;

    const available = near.flatMap((p) => numbersIn(p.text));
    for (const [field, value] of wanted) {
      const at = available.findIndex((n) => Math.abs(n - value) < 1e-9);
      if (at === -1) {
        failures.push({
          check: 6,
          reason:
            `${field} ${value} has no occurrence of its own near "${activity.label}" — ` +
            `the text states that number fewer times than the extraction uses it`,
        });
        continue;
      }
      // Consumed, so the next field cannot claim the same occurrence.
      available.splice(at, 1);
    }
  }
  return failures;
}

/**
 * Runs all six checks and, when they pass, returns the day's unallocated minutes.
 *
 * Every check runs even after one has failed: a caller retrying once is better
 * served by the whole list than by the first thing that went wrong.
 */
export function checkExtraction(activities: ExtractedActivity[], day: DayText): CheckResult {
  const failures: CheckFailure[] = [];

  // ── 1. Digit provenance, by proximity ────────────────────────────────────
  failures.push(...checkProvenance(activities, day));

  // ── 2. No over-allocation ────────────────────────────────────────────────
  /* One minute of slack, not a hundredth of an hour: the unit is minutes now,
     so the tolerance is the smallest thing the record can express. */
  const allocated = activities.reduce((sum, a) => sum + (durationMinutes(a) ?? 0), 0);
  if (allocated > day.workingMinutes + 1) {
    failures.push({
      check: 2,
      reason: `activities allocate ${allocated} minutes against a recorded ${day.workingMinutes}`,
    });
  }

  // ── 4. Coverage ──────────────────────────────────────────────────────────
  if (activities.length === 0) {
    failures.push({ check: 4, reason: "no activities" });
  }
  for (const [i, activity] of activities.entries()) {
    if (activity.label.trim() === "") {
      failures.push({ check: 4, reason: `activity ${i} has an empty label` });
    }
  }

  // ── 6. Distinct occurrence ───────────────────────────────────────────────
  failures.push(...checkDistinctOccurrence(activities, day));

  // ── 5. No fabricated activities ──────────────────────────────────────────
  const dayWords = meaningfulWords(day.deliverable);
  for (const activity of activities) {
    const words = meaningfulWords(activity.label);
    if (words.size > 0 && ![...words].some((w) => dayWords.has(w))) {
      failures.push({
        check: 5,
        reason: `"${activity.label}" shares no meaningful word with the day's text`,
      });
    }
  }

  if (failures.length > 0) return { ok: false, failures };

  /* ── 3. Reconciliation ──────────────────────────────────────────────────
   * Not a check that can fail. `S = 0` means the instructor named activities
   * without stating a duration for any of them, so the whole day is
   * unallocated — valid, and on migrated days it is the norm.
   *
   * Whole minutes in, whole minutes out. Nothing rounds here, so nothing can
   * leave a spurious hundredth behind — which is why the column changed. */
  return { ok: true, unallocatedMinutes: day.workingMinutes - allocated };
}
