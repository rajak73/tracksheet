/**
 * Call 1 — label the day.
 *
 * One call per day, cached against the day's content hash. It is given the
 * DESCRIPTIONS the instructor wrote and nothing else: no counts, no durations,
 * not the day's total. It answers with a label, a subtopic, a topic and the
 * noun the activity would be counted in.
 *
 * ── Why the numbers are withheld rather than merely unwanted ──────────────
 * A model that can see a figure will eventually repeat one, and a repeated
 * figure is a second source for a number the form already holds exactly. When
 * the two disagree, the one on screen is the invented one — and inside a cached
 * summary it stays there until the day changes, which for a closed month is
 * never. So the counts are not asked to be ignored; they are simply not part of
 * the question. The sentence is assembled afterwards, in code, by
 * `renderDaySummary`.
 *
 * ── And still no list of work areas ───────────────────────────────────────
 * `topic` is inferred from the writer's own subtopic — "AVL rotations" belongs
 * to "DSA" — and is null whenever the activity names no subject matter at all.
 * It is never chosen from a fixed set. A list of areas in a prompt is a
 * taxonomy, and it would be the taxonomy this product spent months removing,
 * reappearing in the one place nobody thinks to look.
 */
import { generateStructured } from "@/server/ai/gemini";

/** One labelled activity. Not one figure among them — see the note above. */
export type DayLabel = {
  /** A short verb phrase. Never contains a digit; that is checked. */
  label: string;
  /** The specific thing it was about, quoted from the text. */
  subtopic: string | null;
  /** The broader area, inferred. Null wherever it would be a guess. */
  topic: string | null;
  /** The plural noun the activity is counted in: `classes`, `submissions`. */
  unit: string;
};

export type LabelResult = { ok: true; labels: DayLabel[] } | { ok: false; reason: string };

/**
 * The system instruction. Sent as a system instruction rather than folded into
 * the prompt, so the rules are not read as part of the day being described.
 *
 * Bump `PROMPT_VERSION_EXTRACT` in `context.ts` whenever this text changes —
 * the version is inside the context hash, so a bump is what re-reads every day
 * that was labelled by the old wording.
 */
export const LABEL_SYSTEM = [
  "You label work log activities written by teaching faculty running SDE",
  "preparation training. You are given one day's activities. You return a",
  "label, subtopic and topic for each.",
  "",
  "Absolute rules:",
  "",
  "1. Never output a number of any kind. Counts and durations are supplied",
  "   separately and are assembled by the application.",
  '2. label is a short verb phrase saying what the person did. Always keep the',
  '   verb: "Taught binary search", "Learned Java and OOPs", "Reviewed',
  '   submissions", "Ran a doubt session", "Prepared a problem set". A reader',
  "   must be able to tell teaching from learning from reviewing without seeing",
  "   the original text.",
  '3. If the text names no verb — "Doubt clearing session", "Corrected" — use',
  "   the phrase as written. Never invent an action.",
  '4. Do not put counts in the label. "Reviewed 12 submissions" is wrong;',
  '   "Reviewed submissions" is right.',
  '5. subtopic is the specific thing it was about, taken from the text. "Live',
  '   class on binary search" has subtopic "binary search". If nothing specific',
  "   is named, null.",
  '6. topic is the broader area the subtopic belongs to. "binary search"',
  '   belongs to "DSA". "OOPs" belongs to "Java". "deadlock handling" belongs',
  '   to "OS". Name it in the shortest form a reader would recognise.',
  "7. There are exactly two levels, never three. If the text names something",
  '   several levels deep — "AVL rotations" — topic is the broadest',
  '   recognisable area ("DSA") and subtopic is the specific thing named ("AVL',
  '   rotations"). Everything in between collapses into subtopic.',
  "8. Only name a topic you are confident of from the subtopic itself. If the",
  '   activity names no subject matter — "Doubt clearing session", "Reviewed',
  '   submissions", "Office meeting" — topic is null. If the subtopic could',
  '   belong to more than one area — "closures" could be JavaScript or Python —',
  "   topic is null. Prefer null over a guess.",
  "9. Never invent a subtopic that is not in the text. topic may be inferred;",
  "   subtopic may not.",
  '10. unit is the natural plural noun for what was counted: "classes",',
  '    "sessions", "interviews", "submissions", "students", "teams". Use',
  '    "entries" if nothing fits. Do not put this noun inside the label.',
  "11. Preserve the writer's own terminology. Hindi, English or mixed text",
  "    stays as written. Do not translate.",
  "12. Describe, do not evaluate. Never assess performance, effort, or",
  "    sufficiency. Never compare the person to a standard or to another",
  "    period.",
].join("\n");

/** The day, as the model sees it: a date and the descriptions, in order. */
export function labelUserContent(logDate: string, descriptions: string[]): string {
  return [
    `Date: ${logDate}`,
    "Activities:",
    ...descriptions.map((d, i) => `${i + 1}. ${d}`),
  ].join("\n");
}

/**
 * The shape the provider itself must return.
 *
 * A schema makes a malformed reply impossible rather than merely unlikely. It
 * does not make a WRONG one impossible: every rule that matters here — no digit
 * in a label, a label that shares a word with its source — is about content,
 * which no schema can express. Both run.
 */
export const LABEL_SCHEMA = {
  type: "object",
  properties: {
    activities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          subtopic: { type: "string", nullable: true },
          topic: { type: "string", nullable: true },
          unit: { type: "string" },
        },
        required: ["label", "unit"],
      },
    },
  },
  required: ["activities"],
} as const;

const HAS_DIGIT = /\d/;

/** Nouns that measure time rather than count things. */
const TIME_NOUNS = new Set([
  "h", "hr", "hrs", "hour", "hours",
  "m", "min", "mins", "minute", "minutes",
  "sec", "secs", "second", "seconds",
  "day", "days", "week", "weeks",
]);

/**
 * The noun a count is written in — never a unit of time.
 *
 * ── Why this is normalised and not refused ────────────────────────────────
 * Observed live: "i learned java and oops for 5hr" came back with
 * `unit: "hours"`, taken from the writer's own "5hr". It is a reasonable
 * reading of the sentence and a useless unit, because the number it would sit
 * beside is the QUANTITY from the row, not the duration — the day would render
 * "Learned Java and OOPs (1 hours, 5h)", which states a length of time twice
 * and gets one of them wrong.
 *
 * Refusing the reply would cost the whole day's labels over a cosmetic field
 * and, after the retry, render the instructor's raw text instead of a summary.
 * So it falls back to the noun the rules already name for a unit that does not
 * fit. Nothing is invented: "entries" is what the twelfth rule asks for when
 * nothing fits, and a time noun does not fit.
 */
export function countableUnit(unit: string): string {
  if (unit === "" || TIME_NOUNS.has(unit.toLowerCase())) return "entries";
  return unit;
}

/** Words too common to prove anything by sharing. */
const STOPWORDS = new Set(["and", "the", "for", "on", "of", "to", "a", "in"]);

const meaningfulWords = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

/**
 * Does this phrase come from that text?
 *
 * ── Why exact word equality is not the test ───────────────────────────────
 * "take a dead lock class" should label as "Taught deadlock handling", which is
 * the specified behaviour and shares no whole word with its source: the writer
 * split the compound and the label closed it. Requiring equality would refuse
 * the very answer that was asked for.
 *
 * So a word also matches when one contains the other and the shorter is at
 * least four letters — "deadlock" against "lock". Short enough to catch a
 * compound, long enough that "on" cannot vouch for "conducted". Numerals are
 * excluded from both sides: a figure can never be the thing that proves a label
 * came from the text.
 */
export function sharesWord(phrase: string, source: string): boolean {
  const from = meaningfulWords(source);
  return meaningfulWords(phrase).some((word) =>
    from.some(
      (other) =>
        word === other ||
        (word.length >= 4 && other.includes(word)) ||
        (other.length >= 4 && word.includes(other)),
    ),
  );
}

/**
 * Validate a labelling reply against the descriptions it was given.
 *
 * Rejects rather than repairs. A repaired label is one nobody asked the model
 * for and nobody can trace back to the record.
 */
export function parseLabels(text: string, sources: string[]): LabelResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the reply was not JSON" };
  }
  const activities = (parsed as { activities?: unknown })?.activities;
  if (!Array.isArray(activities)) return { ok: false, reason: "no activities array" };

  /* 1. One label per row, in the order they were sent. A reply of a different
        length cannot be lined up with the rows that hold the numbers, and
        guessing which row lost its label is how a duration ends up beside the
        wrong activity. */
  if (activities.length !== sources.length) {
    return {
      ok: false,
      reason: `${activities.length} labels for ${sources.length} activities`,
    };
  }

  const labels: DayLabel[] = [];
  for (let i = 0; i < activities.length; i++) {
    const raw = activities[i];
    if (typeof raw !== "object" || raw === null) return { ok: false, reason: "a label is not an object" };
    const a = raw as Record<string, unknown>;
    const source = sources[i]!;

    if (typeof a.label !== "string" || a.label.trim() === "") {
      return { ok: false, reason: `activity ${i + 1} has no label` };
    }
    const label = a.label.trim();

    /* 2. The tripwire. A digit in a label means the model has started counting,
          which is the one thing this whole split exists to prevent. */
    if (HAS_DIGIT.test(label)) {
      return { ok: false, reason: `label "${label}" states a number` };
    }

    // 3. The label describes THIS activity, not one the model had in mind.
    if (!sharesWord(label, source)) {
      return { ok: false, reason: `label "${label}" shares no word with "${source}"` };
    }

    const subtopic = typeof a.subtopic === "string" && a.subtopic.trim() !== "" ? a.subtopic.trim() : null;
    // 4. topic may be inferred; a subtopic may only be quoted.
    if (subtopic !== null && !sharesWord(subtopic, source)) {
      return { ok: false, reason: `subtopic "${subtopic}" is not in "${source}"` };
    }
    const topic = typeof a.topic === "string" && a.topic.trim() !== "" ? a.topic.trim() : null;
    const unit = countableUnit(typeof a.unit === "string" ? a.unit.trim() : "");

    labels.push({ label, subtopic, topic, unit });
  }

  return { ok: true, labels };
}

/** One retry. See {@link GROUPING_ATTEMPTS} for why the period gets three. */
export const LABEL_ATTEMPTS = 2;

/** The provider call, configured as the labelling task requires. */
export function labelCall(instruction: string) {
  return generateStructured(instruction, {
    system: LABEL_SYSTEM,
    responseSchema: LABEL_SCHEMA,
    /* Zero, so a day whose cache expired re-reads identically. Somebody
       comparing two screenshots of an unchanged day would otherwise have no way
       to tell a re-wording from an edit. */
    temperature: 0,
    /* No `thinkingBudget` — deliberately, and it is NOT a departure from
       "labelling, not reasoning". That instruction is carried out by the
       chain's own per-model `thinkingLevel`, which is the spelling these models
       accept.
       
       Measured against the live API rather than assumed. `thinkingBudget: 0` is
       a 400 on `gemini-flash-lite-latest`, a 400 on `gemini-3.6-flash` (which
       is what put the note in `gemini.ts`), and on the one chain model that
       does take it — `gemini-3.1-flash-lite` — the same call took 7.8s against
       2.7s for `thinkingLevel: "low"`, for identical labels. Sending it would
       break two models out of three to make the third slower. */
    maxOutputTokens: 800,
  });
}

/**
 * Label a day, retrying once. On failure the caller stores `FAILED` and the
 * screen renders the instructor's own descriptions, unchanged.
 */
export async function runLabelling(
  logDate: string,
  descriptions: string[],
  call: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }> = labelCall,
): Promise<LabelResult> {
  if (descriptions.length === 0) return { ok: true, labels: [] };
  const instruction = labelUserContent(logDate, descriptions);
  let reason = "the model was never called";

  for (let attempt = 1; attempt <= LABEL_ATTEMPTS; attempt++) {
    const reply = await call(instruction);
    if (!reply.ok) {
      reason = `provider: ${reply.reason}`;
      console.info(`[label] attempt ${attempt}/${LABEL_ATTEMPTS} — ${reason}`);
      continue;
    }
    const parsed = parseLabels(reply.text, descriptions);
    if (parsed.ok) return parsed;
    reason = parsed.reason;
    console.info(`[label] attempt ${attempt}/${LABEL_ATTEMPTS} refused — ${reason}`);
  }
  return { ok: false, reason };
}
