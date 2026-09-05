/**
 * A period, aggregated in code.
 *
 * ── Why there is no model call here any more ──────────────────────────────
 * A day's normalisation now stores the action, the subject and the topics
 * apart from the phrase. Once those exist, grouping a week is not a judgement —
 * it is a join: same action and same subject is one line, the topics under it
 * are a set union, and the minutes are a sum over the sources. Code does that
 * correctly every time and for free.
 *
 * Asking a model to redo it would be paying for a second opinion on arithmetic,
 * and at twelve hundred instructors it would be a model call per person per
 * period — the cost that made period generation unusable at scale.
 *
 * The semantic judgement is still the model's. It happens once, per activity,
 * on the day the work was written. This only reuses it.
 */
import type { InsightItem } from "./worklog-summary";

/** Case- and punctuation-insensitive, so two spellings of one word merge. */
const key = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** `a, b and c` — the last joined with `and`, as a person would write it. */
function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * How many topics a level shows.
 *
 * A week keeps what it covered. A month with twenty topics is a list nobody
 * reads, so it keeps the ones with the most time behind them — which is the
 * only ordering the record actually supports. Three to seven is the range the
 * specification asks for; the cap is where a list stops being scannable.
 */
const TOPIC_CAP = { WEEK: 8, MONTH: 6 } as const;

type Bucket = {
  action: string | null;
  subject: string | null;
  /** Topic → minutes, so the month can keep the ones that mattered. */
  topicMinutes: Map<string, { display: string; minutes: number }>;
  subtopicMinutes: Map<string, { display: string; minutes: number }>;
  /** The day's own phrase, for a bucket with no structure to rebuild from. */
  fallbackLabel: string;
  minutes: number;
};

/**
 * Consolidate a period's daily items.
 *
 * ── What groups, and what deliberately does not ───────────────────────────
 * Same action AND same subject. Teaching Arrays and Teaching Binary Search
 * merge under DSA when the day said DSA for both; Teaching Arrays and Learning
 * Arrays never merge, because the actions differ and that is the distinction
 * the whole system exists to preserve. Two different subjects never merge
 * either — Teaching Java and Teaching Mathematics stay two lines, however
 * similar the verb.
 *
 * An item with no subject groups only with other items of the same action AND
 * the same topic, so an ambiguous "Teaching Sets" is never quietly folded into
 * a subject somebody else's activity happened to name.
 */
export function aggregatePeriod(
  items: InsightItem[],
  level: "WEEK" | "MONTH",
): InsightItem[] {
  /* ── One pass to learn which words were used as subjects ────────────────
   *
   * Stage B is asked per activity, so across a week it can call the same word a
   * SUBJECT one day and a TOPIC the next — "Teaching DSA: Binary Search" and
   * "Teaching DSA" then sit on two lines for the same work. Reading all the
   * items first settles it: a word that any day used as the subject for this
   * action is the subject for all of them.
   *
   * This is not a vocabulary. Nothing is listed anywhere; the set is built from
   * the values in front of it, every time, and is empty for work nobody has
   * described that way. */
  const subjectsByAction = new Map<string, Set<string>>();
  for (const item of items) {
    const action = item.action?.trim();
    const subject = item.subject?.trim();
    if (!action || !subject) continue;
    const known = subjectsByAction.get(key(action)) ?? new Set<string>();
    known.add(key(subject));
    subjectsByAction.set(key(action), known);
  }

  const buckets = new Map<string, Bucket>();

  for (const item of items) {
    const action = item.action?.trim() || null;
    let subject = item.subject?.trim() || null;
    let topics = item.topics;

    /* No subject, and its only topic is a word this action already treats as
       one. The day meant the same thing and said it differently. */
    if (!subject && action && topics.length === 1) {
      const promoted = topics[0]!;
      if (subjectsByAction.get(key(action))?.has(key(promoted))) {
        subject = promoted;
        topics = [];
      }
    }

    /* With no subject there is nothing broad to group under, so the topic is
       what keeps two unrelated activities apart. With no action either, the
       phrase itself is the only identity the item has. */
    const identity = action
      ? subject
        ? `a:${key(action)}|s:${key(subject)}`
        : `a:${key(action)}|t:${topics.map(key).sort().join(",") || key(item.activity)}`
      : `p:${key(item.activity)}`;

    const bucket =
      buckets.get(identity) ??
      {
        action,
        subject,
        topicMinutes: new Map(),
        subtopicMinutes: new Map(),
        fallbackLabel: item.activity,
        minutes: 0,
      };

    bucket.minutes += item.durationMinutes;
    for (const topic of topics) {
      const k = key(topic);
      const seen = bucket.topicMinutes.get(k);
      if (seen) seen.minutes += item.durationMinutes;
      else bucket.topicMinutes.set(k, { display: topic, minutes: item.durationMinutes });
    }
    for (const sub of item.subtopics) {
      const k = key(sub);
      const seen = bucket.subtopicMinutes.get(k);
      if (seen) seen.minutes += item.durationMinutes;
      else bucket.subtopicMinutes.set(k, { display: sub, minutes: item.durationMinutes });
    }
    buckets.set(identity, bucket);
  }

  const out: InsightItem[] = [];
  for (const bucket of buckets.values()) {
    const topics = [...bucket.topicMinutes.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .map((t) => t.display);
    const subtopics = [...bucket.subtopicMinutes.values()]
      .sort((a, b) => b.minutes - a.minutes)
      .map((t) => t.display);

    out.push({
      activity: labelFor(bucket, topics, level),
      action: bucket.action,
      subject: bucket.subject,
      topics,
      subtopics,
      durationMinutes: bucket.minutes,
    });
  }

  return out.sort((a, b) => b.durationMinutes - a.durationMinutes);
}

/**
 * The line a bucket reads as.
 *
 * ── Topic compression, without a taxonomy ─────────────────────────────────
 * A month drops the subtopics and keeps the topics, which is the compression
 * the specification describes — Lower Bound and Upper Bound disappear under
 * Binary Search, not because anything knows they belong to it, but because the
 * day that named them also named their topic. The relationship comes from the
 * worklog every time; nothing is mapped here.
 *
 * Where a bucket has no structure at all, the day's own phrase stands. A label
 * rebuilt from nothing would be worse than the one a person already read.
 */
function labelFor(bucket: Bucket, topics: string[], level: "WEEK" | "MONTH"): string {
  if (!bucket.action) return bucket.fallbackLabel;

  const kept = topics.slice(0, TOPIC_CAP[level]);
  const head = bucket.subject ? `${bucket.action} ${bucket.subject}` : bucket.action;

  /* No topics to name. With a subject the head still reads ("Teaching DSA");
     without one it would be a bare verb, so the day's own phrase stands. */
  if (kept.length === 0) return bucket.subject ? head : bucket.fallbackLabel;

  /* Without a subject the topics ARE the subject — "Teaching Sets" rather than
     "Teaching: Sets", which reads as a heading with nothing above it. */
  if (!bucket.subject) return `${bucket.action} ${joinList(kept)}`;

  return `${head}: ${joinList(kept)}`;
}
