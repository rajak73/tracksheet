/**
 * The sentence, written in code.
 *
 * ── Why the model does not write this ─────────────────────────────────────
 * A model that writes the prose writes the numbers in it too, and a wrong
 * number inside a cached summary stays wrong until the underlying day changes —
 * which, for a closed month, is never. The counts and the durations are already
 * exact: they came out of the form. So the model labels and it groups, and
 * every figure below is assembled here from the rows the instructor filled in.
 *
 * Nothing in this file talks to a provider, reads a database or knows what a
 * request is. It takes activities and groups that already carry their numbers
 * and returns the words. That is what makes the arithmetic testable without a
 * key, and it is why the tests for it are the bulk of the tests for the
 * feature.
 */

/**
 * A duration as a report writes it beside an activity: `3h`, `1h 30m`, `45m`.
 *
 * Whole hours drop the minutes INSIDE a sentence. `3h 00m` in a comma-separated
 * list is a spreadsheet cell wearing prose; the two zeroes exist to line a
 * column up, and there is no column here.
 */
export function formatSpan(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * The same duration as a TOTAL: `7h 00m`.
 *
 * The total keeps both halves even when the minutes are zero. It is the figure
 * somebody checks against the timesheet, and a total that renders `7h` one week
 * and `7h 30m` the next is two different shapes of the same field.
 *
 * Not `formatMinutes` — that pads the hours as well (`07h 00m`), which is right
 * for the sheet's column of figures and wrong at the end of a sentence.
 */
export function formatTotal(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/** One activity, as the day's row holds it. The model supplied only `label`. */
export type SummaryActivity = {
  /** From the labelling call. Never contains a digit — that is checked there. */
  label: string;
  /** What the instructor counted, or null where they counted nothing. */
  qty: number | null;
  /** The plural noun for what was counted: `classes`, `submissions`. */
  unit: string | null;
  /** Whole minutes, or null where the row recorded no duration. */
  minutes: number | null;
};

/** Case- and plural-insensitive, the same deliberately dumb rule as subtopics. */
const stem = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");

/**
 * `classes` → `class`, `entries` → `entry`, `sessions` → `session`.
 *
 * Dumb on purpose, like `subtopicKey`: the four endings English actually uses
 * for these nouns, and nothing else. An irregular plural comes back unchanged,
 * which reads as the writer's own word rather than as a bad guess at it.
 */
export const singular = (phrase: string) =>
  phrase
    .replace(/ies$/, "y")
    .replace(/(ss|sh|ch|x|s)es$/, "$1")
    .replace(/([^s])s$/, "$1");

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** Does this text already contain the noun the count would be measured in? */
function statesUnit(text: string, unit: string | null): boolean {
  if (!unit) return false;
  const target = stem(unit);
  if (!target) return false;
  return words(text).some((w) => stem(w) === target);
}

/**
 * One activity: `{label} ({qty} {unit}, {duration})`.
 *
 * Each figure is dropped rather than faked when the row does not carry it, so a
 * day nobody timed renders `Reviewed submissions (12)` and not a zero.
 *
 * ── The repeated noun ─────────────────────────────────────────────────────
 * "Reviewed submissions" with twelve submissions is `Reviewed submissions
 * (12, 1h 30m)`. Printing the noun again gives "Reviewed submissions (12
 * submissions", which reads as though the second twelve were something else.
 */
export function renderActivity(activity: SummaryActivity): string {
  const inner: string[] = [];
  if (activity.qty !== null) {
    /* One of a thing takes the singular noun. "1 classes" is the sort of
       mistake a reader stops on, and it is entirely avoidable: the count and
       the noun are both here. */
    const unit = activity.unit ?? "entries";
    inner.push(
      statesUnit(activity.label, activity.unit)
        ? String(activity.qty)
        : `${activity.qty} ${activity.qty === 1 ? singular(unit) : unit}`,
    );
  }
  if (activity.minutes !== null) inner.push(formatSpan(activity.minutes));
  return inner.length === 0 ? activity.label : `${activity.label} (${inner.join(", ")})`;
}

/**
 * Lowercase a clause that is no longer the first thing in the sentence.
 *
 * Only when the word is ordinary prose. `DSA` must not become `dSA`, and a
 * label beginning with a name the writer capitalised is theirs, not ours — the
 * second character tells the two apart without a dictionary.
 */
function decapitalise(text: string): string {
  const second = text.charAt(1);
  if (second && second === second.toUpperCase() && second !== second.toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The day: what was done, in the order it was entered, and how long it took.
 *
 *   Taught binary search (2 classes, 3h), ran a doubt session (1h) — 4h 00m
 *
 * One activity is a valid day. It renders as one clause and the total, because
 * a day with one thing in it did one thing.
 */
export function renderDaySummary(activities: SummaryActivity[], totalMinutes: number): string {
  if (activities.length === 0) return "";
  const clauses = activities
    .map(renderActivity)
    .map((text, i) => (i === 0 ? text : decapitalise(text)));
  return `${clauses.join(", ")} — ${formatTotal(totalMinutes)}`;
}

/**
 * One group of the period's work, with every figure already summed from rows.
 *
 * `name` is the model's: `"DSA — taught"` where a topic exists, the action
 * alone — `"Doubt clearing"` — where none does.
 */
export type SummaryGroup = {
  name: string;
  /** Sum of member quantities. Null when no member counted anything. */
  count: number | null;
  unit: string | null;
  minutes: number;
  /** Distinct dates the group appears on. */
  days: number;
  /** What it covered, in the writer's words. Empty where nothing was named. */
  subtopics: string[];
};

/** `"DSA — taught"` → topic `DSA`, action `taught`. No dash: action only. */
export function splitGroupName(name: string): { topic: string | null; action: string } {
  const parts = name.split(/\s+[—–-]\s+/);
  if (parts.length >= 2 && parts[0]!.trim() && parts[1]!.trim()) {
    return { topic: parts[0]!.trim(), action: parts.slice(1).join(" — ").trim() };
  }
  return { topic: null, action: name.trim() };
}

/** Does this phrase already END in the noun the group is counted in? */
const endsInUnit = (phrase: string, unit: string) => {
  const last = words(phrase).at(-1);
  return Boolean(last) && stem(last!) === stem(unit);
};

/**
 * What the group's count counts: `DSA classes`, `mock interviews`, `contests`.
 *
 * ── Two ways the noun is already there ────────────────────────────────────
 * With a topic it is `{topic} {unit}` — "9 DSA classes" — UNLESS the topic is
 * itself the thing being counted. "Mock interviews — ran", counted in
 * interviews, is "22 mock interviews" and not "22 Mock interviews interviews",
 * which is what the first version of this printed.
 *
 * Without a topic the group's own name is used on the same test: "Mock
 * interviews" counted in interviews is "5 mock interviews". Where the name does
 * not end in the noun — "Submission review" counted in submissions — the noun
 * stands alone: "32 submissions".
 *
 * The alternative is gluing the name to the unit, which produces "32 submission
 * review submissions". Code cannot conjugate English, and a group that reads a
 * little plainer than it might have is a smaller fault than one that reads as
 * though it were generated.
 */
function countPhrase(group: SummaryGroup): string {
  const { topic } = splitGroupName(group.name);
  const unit = group.unit ?? "entries";
  const base = topic
    ? endsInUnit(topic, unit)
      ? topic
      : `${topic} ${unit}`
    : endsInUnit(group.name, unit)
      ? group.name
      : unit;
  /* Lowercased for the middle of a sentence, by the same guard the day clauses
     use: "Mock interviews" becomes "mock interviews" and "DSA" stays "DSA". */
  return decapitalise(base);
}

/**
 * A group as a phrase with its count in it: `5 mock interviews`, `a contest`.
 *
 * A count of one is written `a`. "1 contest with editorial" reads as a figure
 * somebody is meant to check; "a contest with editorial" reads as English, and
 * both say the same thing because the one is the whole of it.
 */
export function renderGroupPhrase(group: SummaryGroup): string {
  /* An uncounted group is named, and keeps the capital the model gave it.
     "Amazon OA prep" is a name; lowercasing it mid-sentence would be correcting
     the writer's own capitalisation on a guess about what is a proper noun. */
  if (group.count === null) return group.name;
  if (group.count === 1) return `a ${singular(countPhrase(group))}`;
  return `${group.count} ${countPhrase(group)}`;
}

/** `binary search, two pointers and hashing` — the last joined with `and`. */
export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const dayCount = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Biggest first, and `Other` last however big it is — it is the leftovers. */
function ordered(groups: SummaryGroup[]): SummaryGroup[] {
  return [...groups].sort((a, b) => {
    const aOther = a.name.toLowerCase() === "other";
    const bOther = b.name.toLowerCase() === "other";
    if (aOther !== bOther) return aOther ? 1 : -1;
    return b.minutes - a.minutes;
  });
}

/**
 * The week, in two lines. The largest group leads; the rest follow in one
 * sentence.
 *
 *   9 DSA classes covering binary search, recursion and hashing — 13h 30m
 *   across 5 days.
 *   Alongside: 5 mock interviews (3h 30m), a contest (3h). 32h 00m total.
 *
 * One group is one line: there is no "alongside" when there was nothing else.
 */
export function renderWeekSummary(groups: SummaryGroup[], totalMinutes: number): string[] {
  const sorted = ordered(groups);
  const lead = sorted[0];
  if (!lead) return [];

  const covering = lead.subtopics.length > 0 ? ` covering ${joinList(lead.subtopics)}` : "";
  const first = `${renderGroupPhrase(lead)}${covering} — ${formatSpan(lead.minutes)} across ${dayCount(lead.days)}.`;
  const total = `${formatTotal(totalMinutes)} total.`;

  const rest = sorted.slice(1);
  if (rest.length === 0) return [`${first} ${total}`];

  const items = rest.map((g) => `${renderGroupPhrase(g)} (${formatSpan(g.minutes)})`);
  return [first, `Alongside: ${items.join(", ")}. ${total}`];
}

/**
 * The month, the same shape one level up: the leading group, then the rest
 * bucketed by the action they share, each bucket with its own subtotal.
 *
 * ── Why the buckets are named after an action ─────────────────────────────
 * The example this was specified from reads "Placement prep:" and
 * "Assessment:" — names that are in neither the groups nor the rows. There are
 * exactly two places they could come from: a fixed list of work areas, or the
 * model. The first is a category system, which this product does not have
 * anywhere, under any name; the second was ruled out in the same breath ("Do
 * not ask the model for bucket names").
 *
 * So a bucket is named by the one thing its groups genuinely share — the action
 * already written in each group's name. "Taught:", "Reviewed:". A bucket needs
 * two groups to be worth drawing; a lone group goes to the closing sentence.
 * Fewer buckets means fewer lines, never a line padded to fill a shape.
 */
export function renderMonthSummary(groups: SummaryGroup[], totalMinutes: number): string[] {
  const sorted = ordered(groups);
  const lead = sorted[0];
  if (!lead) return [];

  const across = lead.subtopics.length > 0 ? ` across ${joinList(lead.subtopics)}` : "";
  const lines = [
    `${renderGroupPhrase(lead)}${across} — ${formatSpan(lead.minutes)} over ${dayCount(lead.days)}.`,
  ];
  const total = `${formatTotal(totalMinutes)} total.`;

  const rest = sorted.slice(1);
  if (rest.length === 0) return [`${lines[0]} ${total}`];

  const buckets = new Map<string, SummaryGroup[]>();
  for (const group of rest) {
    const key = splitGroupName(group.name).action.toLowerCase();
    buckets.set(key, [...(buckets.get(key) ?? []), group]);
  }

  const named = [...buckets.entries()].filter(([, gs]) => gs.length > 1);
  const loose = [...buckets.entries()].filter(([, gs]) => gs.length === 1).flatMap(([, gs]) => gs);

  const sentences: string[] = [];
  for (const [action, members] of named) {
    const minutes = members.reduce((n, g) => n + g.minutes, 0);
    const label = action.charAt(0).toUpperCase() + action.slice(1);
    sentences.push(
      `${label}: ${members.map(renderGroupPhrase).join(", ")} — ${formatSpan(minutes)}.`,
    );
  }
  if (loose.length > 0) {
    const minutes = loose.reduce((n, g) => n + g.minutes, 0);
    sentences.push(`Also: ${loose.map(renderGroupPhrase).join(", ")} — ${formatSpan(minutes)}.`);
  }

  if (sentences.length === 0) return [`${lines[0]} ${total}`];
  sentences[sentences.length - 1] = `${sentences.at(-1)} ${total}`;
  return [...lines, ...sentences];
}

/**
 * The closing check: what the groups account for is what the period recorded.
 *
 * A summary that adds up to something other than the timesheet is worse than no
 * summary — it is a second, authoritative-looking figure for a number the sheet
 * already states. A payload failing this is not stored.
 */
export function groupsReconcile(groups: SummaryGroup[], totalMinutes: number): boolean {
  return groups.reduce((n, g) => n + g.minutes, 0) === totalMinutes;
}
