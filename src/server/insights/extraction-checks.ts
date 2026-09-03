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
  /**
   * The specific thing this activity was about, TAKEN FROM THE TEXT.
   *
   * "Live class on binary search" has subtopic "binary search". Null when the
   * text names nothing specific. Never inferred: check 5 refuses a subtopic
   * whose words are not in the day's own writing, because a subtopic is a
   * quotation and an invented one is an invented fact.
   */
  subtopic: string | null;
  /**
   * The broader area the subtopic belongs to. "binary search" is "DSA".
   *
   * ── The one inference this system allows, and its bound ─────────────────
   * Every other rule here says use only what is written, and deriving "DSA"
   * from "binary search" is knowledge the text does not contain. It is allowed
   * because TOPIC NEVER TOUCHES A NUMBER: sessions and durations are summed in
   * code from members, so a topic assigned oddly groups things oddly and cannot
   * make a count wrong.
   *
   * The bound is exact: a subtopic must be in the text, a topic may be inferred
   * from it, and nothing else may be inferred at all.
   *
   * Null when the activity names no subject matter — "Doubt clearing session",
   * "Office meeting", "Corrected". Null is a correct outcome, not a gap: such
   * an activity is displayed on its own.
   *
   * This is not the taxonomy returning. There is no list of topics anywhere —
   * no table, no enum, no seed, no constant, no prompt vocabulary — the model
   * names it from the instructor's own words each time, it is never stored on
   * `WorklogEntry` or hashed into the context, and it is never a filter.
   */
  topic: string | null;
  /**
   * The noun the text uses for `sessions` — "classes", "students", "papers".
   *
   * A count without its noun reads as a bare number, and "3" beside "mentored
   * final year students" is not the same fact as "3 students". Quoted like a
   * subtopic rather than chosen from a list, and null when the text supplies no
   * noun, in which case the number renders alone.
   */
  sessions_unit?: string | null;
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
  | {
      ok: true;
      unallocatedMinutes: number;
      /** The activities AS KEPT — unattributable numbers replaced with null. */
      activities: ExtractedActivity[];
      /** What was dropped, so the rate is visible rather than silent. */
      nulled: NulledNumber[];
    }
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
 * Attribution — which of an activity's numbers the text actually supports.
 *
 * ── Checks 1 and 6, resolved together ─────────────────────────────────────
 * They are one question asked twice. Check 1 asks whether a number appears near
 * its activity; check 6 asks whether it has an occurrence of its OWN. Consuming
 * occurrences answers both: a number that finds nothing left to take is either
 * absent (1) or already spoken for (6).
 *
 * ── Why this nulls rather than refuses ────────────────────────────────────
 * It used to fail the whole day. On real legacy data that threw away days that
 * were perfectly readable: `live class on binary tree, doubt class, office
 * meeting` beside a quantity box reading `1, 1, 1, 1, 1` has five good labels
 * and five numbers nobody can attach to them — the only evidence linking a `1`
 * to an activity is its POSITION, which is what this check exists to distrust.
 *
 * The activities are still true. Only the numbers are unknown, and `null`
 * already means exactly that: the text does not state it. So the number is
 * dropped and the day survives.
 *
 * This does not reopen the hole. An invented number is still removed — it is
 * removed by nulling instead of by discarding everything around it.
 */
export type NulledNumber = {
  label: string;
  field: "sessions" | "duration_value";
  /** What the model claimed, so a log line says what was thrown away. */
  value: number;
  /** The segments the label matched — where the number should have been. */
  segments: string[];
  /**
   * Why it could not be attributed, which is the difference between a format
   * that cannot carry the link and a model inventing figures.
   *
   * - `elsewhere` — the value IS in the day's text, just not beside this label.
   *   The legacy two-box shape: `live class, doubt class` in one box and
   *   `1, 1, 1, 1, 1` in another. Nobody can say which `1` is which, and that
   *   is a property of what was written.
   * - `already-used` — in the matched segment, but every occurrence of it has
   *   been claimed by an earlier field.
   * - `absent` — nowhere in the day's text at all. The model made it up.
   */
  reason: "elsewhere" | "already-used" | "absent";
};

type Attribution = {
  activities: ExtractedActivity[];
  nulled: NulledNumber[];
  /** Every number the model stated, attributable or not. */
  stated: number;
  /** Of those, how many appear NOWHERE in the day's text. */
  invented: number;
};

function attribute(activities: ExtractedActivity[], day: DayText): Attribution {
  /* ── Which text a number may have come from ───────────────────────────
     The deliverable's segments are matched by PROXIMITY, always. The quantity
     box's segments are admitted wholesale, and only when the day holds ONE
     activity.

     The box describes the whole day. With one activity there is nothing to
     disambiguate and its number may fill that activity's count. With several it
     is a list joined to the descriptions by nothing but order — "1, 1, 12, 1,
     4, 1, 1, 1, 6" beside nine of them, and one real day with five descriptions
     against four numbers — so admitting it would let any of its numbers vouch
     for any activity that happened to share a word.

     Kept apart because the box has no words for a label to overlap: "1" is a
     segment of its own, so no proximity rule can ever match it. Admitting
     everything instead would let one line's number vouch for another line's
     activity, which is exactly the guarantee the deliverable text exists to
     give — and five provenance tests said so the moment it was tried. */
  const parts = segments(day.deliverable).map((text) => ({
    text,
    words: meaningfulWords(text),
    unambiguous: false,
  }));
  if (activities.length === 1 && day.deliverableQuantity) {
    for (const text of segments(day.deliverableQuantity)) {
      parts.push({ text, words: meaningfulWords(text), unambiguous: true });
    }
  }

  /* Every number the whole day states — INCLUDING the quantity box, whether or
     not attribution was allowed to use it.
     
     "Is this number written on this day?" and "may it be attached to this
     activity?" are different questions, and only the first decides whether a
     number was invented. Computing this from the attribution source instead
     reclassified every legacy two-box count from `elsewhere` to `absent`, which
     tripped the guessing guard and failed exactly the days that change exists
     to rescue. */
  const anywhere = segments([day.deliverable, day.deliverableQuantity ?? ""].filter(Boolean).join("\n"))
    .flatMap((text) => numbersIn(text));
  const inDay = (value: number) => anywhere.some((n) => Math.abs(n - value) < 1e-9);

  const out: ExtractedActivity[] = [];
  const nulled: NulledNumber[] = [];
  let stated = 0;
  let invented = 0;

  for (const activity of activities) {
    const labelWords = meaningfulWords(activity.label);
    /* With ONE activity there is nothing to disambiguate: every number on the
       day belongs to it, including the quantity box, which sits in a segment of
       its own with no words for a label to overlap. Proximity is a rule for
       telling several activities apart, and a day with one has none to tell. */
    const near = parts.filter(
      (p) => p.unambiguous || [...p.words].some((w) => labelWords.has(w)),
    );
    const nearText = near.map((p) => p.text);

    /* Occurrences the matched segments actually contain, WITH multiplicity.
       Each field takes one; a field left with nothing to take is unsupported. */
    const available = near.flatMap((p) => numbersIn(p.text));

    const kept: { sessions: number | null; value: number | null; unit: DurationUnit | null } = {
      sessions: activity.sessions,
      value: activity.duration_value,
      unit: activity.duration_unit,
    };

    const claim = (field: "sessions" | "duration_value", value: number): boolean => {
      stated += 1;
      const at = available.findIndex((n) => Math.abs(n - value) < 1e-9);
      if (at === -1) {
        const reason = near.some((p) => states(p.text, value))
          ? ("already-used" as const)
          : inDay(value)
            ? ("elsewhere" as const)
            : ("absent" as const);
        if (reason === "absent") invented += 1;
        nulled.push({ label: activity.label, field, value, segments: nearText, reason });
        return false;
      }
      available.splice(at, 1);
      return true;
    };

    if (kept.sessions !== null && !claim("sessions", kept.sessions)) kept.sessions = null;
    if (kept.value !== null && !claim("duration_value", kept.value)) {
      kept.value = null;
      // A unit measuring nothing is not a unit.
      kept.unit = null;
    }

    out.push({
      label: activity.label,
      subtopic: activity.subtopic,
      topic: activity.topic,
      sessions_unit: activity.sessions_unit,
      sessions: kept.sessions,
      duration_value: kept.value,
      duration_unit: kept.unit,
    });
  }

  return { activities: out, nulled, stated, invented };
}

/**
 * Runs the checks and, when they pass, returns the day's unallocated minutes
 * alongside the activities AS KEPT — which is not always what was passed in.
 *
 * Every check runs even after one has failed: a caller retrying once is better
 * served by the whole list than by the first thing that went wrong.
 */
export function checkExtraction(activities: ExtractedActivity[], day: DayText): CheckResult {
  const failures: CheckFailure[] = [];

  // ── 1 & 6. Attribution: unsupported numbers are dropped, not fatal ───────
  const { activities: kept, nulled, stated, invented } = attribute(activities, day);

  /* ── The guard that stops nulling being a soft landing ──────────────────
   * A model getting most of its numbers wrong is guessing, and that is a
   * different situation from a day whose format cannot support attribution.
   *
   * Counted on INVENTED numbers only — values that appear nowhere in the day's
   * text. Counting every unattributable number instead would fire hardest on
   * exactly the days this change exists to rescue: a legacy two-box day has all
   * of its numbers written down and none of them attachable, so it would score
   * 100% and fail, which is where this guard was first pointed and it was
   * wrong. Half of the invented ones is the line. */
  if (stated > 0 && invented * 2 > stated) {
    failures.push({
      check: 1,
      reason:
        `${invented} of ${stated} stated numbers appear nowhere in the day's text, ` +
        `which is more than half — the extraction is guessing rather than reading`,
    });
  }

  // ── 2. No over-allocation ────────────────────────────────────────────────
  /* On what SURVIVED attribution. A duration that was dropped allocates
     nothing, so checking the model's original claim would refuse days over time
     that is no longer being claimed. */
  const allocated = kept.reduce((sum, a) => sum + (durationMinutes(a) ?? 0), 0);
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

  // ── 5. No fabricated activities, and no fabricated subtopics ─────────────
  /* Still fatal, and deliberately so. A number nobody wrote can be dropped
     because `null` is a truthful thing to store in its place. There is no
     truthful thing to store in place of an activity that never happened. */
  const dayWords = meaningfulWords(day.deliverable);
  for (const activity of activities) {
    const words = meaningfulWords(activity.label);
    if (words.size > 0 && ![...words].some((w) => dayWords.has(w))) {
      failures.push({
        check: 5,
        reason: `"${activity.label}" shares no meaningful word with the day's text`,
      });
    }

    /* A subtopic is a QUOTATION, so every word of it must be in the text — not
       merely one of them, which is the weaker test the label gets. The label
       may legitimately be tidied ("Live Class on binary search" → "Live class");
       the subtopic is the specific thing the instructor named, and if it is not
       there it was invented.
       
       The topic above it is deliberately unchecked. That is the whole bargain:
       inference is permitted one level up, where it cannot reach a number. */
    if (activity.subtopic !== null) {
      const sub = meaningfulWords(activity.subtopic);
      const missing = [...sub].filter((w) => !dayWords.has(w));
      if (sub.size === 0 || missing.length > 0) {
        failures.push({
          check: 5,
          reason:
            `subtopic "${activity.subtopic}" is not in the day's text` +
            (missing.length ? ` (${missing.join(", ")} appear nowhere)` : ""),
        });
      }
    }
  }

  if (failures.length > 0) return { ok: false, failures };

  /* ── 3. Reconciliation ──────────────────────────────────────────────────
   * Not a check that can fail. `S = 0` means no activity carried a duration the
   * text supports, so the whole day is unallocated — valid, and on legacy days
   * it is the norm.
   *
   * Whole minutes in, whole minutes out. Nothing rounds here. */
  return {
    ok: true,
    activities: kept,
    nulled,
    unallocatedMinutes: day.workingMinutes - allocated,
  };
}
