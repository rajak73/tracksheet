/**
 * The day in words — a summary of what was done, and one line about the day.
 *
 * ── Two different questions, deliberately kept apart ──────────────────────
 * The bullets answer "what did this person do today". The insight answers
 * "what does that tell us about the day" — teaching-heavy, split between
 * delivery and evaluation, a day given over to learning. A summary that only
 * restates the entries is the worklog with different punctuation; the second
 * line is the part that is worth reading.
 *
 * ── Why the model writes no figures ───────────────────────────────────────
 * It groups and it phrases. Each bullet names the activities it covers by
 * index, and the minutes are added HERE from those activities. Asking a model
 * to "add the durations together" would put a second version of every figure on
 * the screen, and when two versions disagree the invented one is the one
 * somebody reads. The reply is refused outright if it contains a digit.
 *
 * ── And no list of work areas ─────────────────────────────────────────────
 * The insight may say a day was mostly teaching. It says so because the
 * instructor's own words say so, not because "Teaching" was offered as one of
 * eight boxes to tick. A fixed set of areas in a prompt is a taxonomy, and it
 * would be the taxonomy this product spent months removing, reappearing in the
 * one place nobody thinks to look.
 */
/** One bullet: the activities it covers, and how it reads. */
export type SummaryBullet = {
  /** Indexes into the day's extracted items. Code sums their minutes. */
  activities: number[];
  /** Prose. No figures — see the note above. */
  text: string;
};

export type DaySummary = { bullets: SummaryBullet[]; insight: string };

/** Any digit at all, anywhere in the reply. */
const HAS_DIGIT = /\d/;

/**
 * The summary half of the extraction prompt.
 *
 * Asked for in the SAME call, not a second one. A day already costs a model
 * call; asking twice would double the bill of every screen in a product whose
 * caching, its manager gate and its bounded page-load queue all exist to avoid
 * exactly that. The prose is validated separately, which is what the second
 * call was really buying.
 */
export function summaryInstruction(): string {
  return [
    "Then, from the activities you just listed, write a summary of the period in",
    "two parts. Name activities by their position in your `activities` array,",
    "counting from zero.",
    "",
    "1. bullets — two to five of them, in the order the work happened.",
    "   - Combine entries that are the same piece of work into one bullet. A",
    '     class and the explanation that went with it are one thing: "Conducted',
    '     binary search classes covering concepts and implementation."',
    "   - Where there are many activities, group them into broader themes rather",
    '     than listing each. Slides, coding examples and practice questions',
    '     become "Prepared teaching material".',
    "   - Say what was DONE and what was delivered, as a manager would write it.",
    '     Not "Binary Search - quantity - hours".',
    "   - Do not pad. With only a few activities, write only a few bullets.",
    "2. insight — ONE sentence answering what this person actually accomplished.",
    "   Say the shape of the day: what most of it went on, and what else it made",
    "   room for. Do not list the bullets again.",
    "",
    "Rules:",
    "- Write NO numbers of any kind, in either part. Not counts, not durations,",
    "  not a number spelled out as a word. Every figure is already known and is",
    "  attached to your bullets afterwards, from the activities each one names.",
    "- Distinguish what KIND of work each thing is, in your own words taken from",
    "  what they wrote — conducting a class, resolving doubts, learning something",
    "  new, marking work, attending a meeting are not the same activity. Do not",
    "  classify them into a fixed set of categories.",
    "- Say only what the words say. Never invent an activity, a subject, a",
    "  person, an outcome, a quantity or a duration. If something is not there,",
    "  leave it out rather than estimating it.",
    "- Plain professional English. No jargon, no long paragraphs.",
    "- Every index appears in exactly one bullet.",
  ].join("\n");
}

export type SummaryResult = { ok: true; summary: DaySummary } | { ok: false; reason: string };

export function parseSummary(text: string, itemCount: number): SummaryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the reply was not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "the reply was not an object" };
  }
  const raw = parsed as { bullets?: unknown; insight?: unknown };

  if (typeof raw.insight !== "string" || raw.insight.trim() === "") {
    return { ok: false, reason: "no insight sentence" };
  }
  if (!Array.isArray(raw.bullets) || raw.bullets.length === 0) {
    return { ok: false, reason: "no bullets" };
  }

  const seen = new Set<number>();
  const bullets: SummaryBullet[] = [];
  for (const item of raw.bullets) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, reason: "a bullet is not an object" };
    }
    const b = item as { activities?: unknown; text?: unknown };
    if (typeof b.text !== "string" || b.text.trim() === "") {
      return { ok: false, reason: "a bullet has no text" };
    }
    if (!Array.isArray(b.activities)) {
      return { ok: false, reason: `bullet "${b.text}" names no activities` };
    }
    const activities: number[] = [];
    for (const n of b.activities) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= itemCount) {
        return { ok: false, reason: `bullet "${b.text}" names an activity that was not sent` };
      }
      if (seen.has(n)) return { ok: false, reason: `activity ${n} is in two bullets` };
      seen.add(n);
      activities.push(n);
    }
    bullets.push({ activities, text: b.text.trim() });
  }

  if (seen.size !== itemCount) {
    return { ok: false, reason: `${itemCount - seen.size} activities were left out` };
  }

  /* The digit test runs on the PROSE, after the indexes have been read off —
     indexes are digits and are the one number the reply must carry. */
  const prose = [raw.insight, ...bullets.map((b) => b.text)].join(" ");
  if (HAS_DIGIT.test(prose)) {
    return { ok: false, reason: "the summary states a number, and the figures are added in code" };
  }

  return { ok: true, summary: { bullets, insight: raw.insight.trim() } };
}

/** Read a stored summary back, or null when the day has none. */
export function parseStoredSummary(value: unknown): DaySummary | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as { bullets?: unknown; insight?: unknown };
  if (typeof v.insight !== "string" || !Array.isArray(v.bullets)) return null;
  const bullets: SummaryBullet[] = [];
  for (const raw of v.bullets) {
    if (typeof raw !== "object" || raw === null) return null;
    const b = raw as { activities?: unknown; text?: unknown };
    if (typeof b.text !== "string" || !Array.isArray(b.activities)) return null;
    bullets.push({ activities: b.activities.filter((n): n is number => typeof n === "number"), text: b.text });
  }
  return { bullets, insight: v.insight };
}
