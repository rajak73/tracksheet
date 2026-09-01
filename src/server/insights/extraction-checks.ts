/**
 * The five checks an extraction must pass before it is stored.
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

/** One activity as the model returned it. */
export type ExtractedActivity = {
  label: string;
  /** How many of the thing. Null when the text does not say. */
  sessions: number | null;
  /** Hours attributed to this activity. Null when the text does not say. */
  hours: number | null;
};

/** The day the extraction describes. */
export type DayText = {
  deliverable: string;
  deliverableQuantity: string | null;
  /** T — the hours the instructor recorded for the day, independently. */
  workingHours: number;
};

export type CheckFailure = {
  /** Which of the five. Numbered as the spec numbers them. */
  check: 1 | 2 | 3 | 4 | 5;
  reason: string;
};

export type CheckResult =
  | { ok: true; unallocatedHours: number }
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
    if (activity.hours !== null) numbers.push(["hours", activity.hours]);
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
 * Runs all five checks and, when they pass, returns the day's unallocated hours.
 *
 * Every check runs even after one has failed: a caller retrying once is better
 * served by the whole list than by the first thing that went wrong.
 */
export function checkExtraction(activities: ExtractedActivity[], day: DayText): CheckResult {
  const failures: CheckFailure[] = [];

  // ── 1. Digit provenance, by proximity ────────────────────────────────────
  failures.push(...checkProvenance(activities, day));

  // ── 2. No over-allocation ────────────────────────────────────────────────
  const allocated = activities.reduce((sum, a) => sum + (a.hours ?? 0), 0);
  if (allocated > day.workingHours + 0.01) {
    failures.push({
      check: 2,
      reason: `activities allocate ${allocated.toFixed(2)}h against a recorded ${day.workingHours.toFixed(2)}h`,
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
   * without stating hours for them, so the whole day is unallocated — valid,
   * and on migrated days it is the norm rather than the exception. */
  return { ok: true, unallocatedHours: Math.round((day.workingHours - allocated) * 100) / 100 };
}
