/**
 * A week or a month: what repeated, and how much of it.
 *
 * ── Where each number comes from ──────────────────────────────────────────
 * The model is asked one question — which of these activities are the same kind
 * of work — and is given labels and dates to answer it with. Every figure below
 * is summed HERE, from the stored day extractions and the raw worklog rows. The
 * model never sees a duration and never returns one.
 *
 * ── The closing check ─────────────────────────────────────────────────────
 * Group minutes plus unallocated must equal the period's recorded total. It is
 * not a sanity check on the model — the model contributed no numbers — it is a
 * check on THIS file's arithmetic and on the extractions it read. If it fails,
 * nothing is stored: a rollup whose parts do not add to its whole is a screen
 * that invites somebody to check the sum and find it wrong.
 */
import { buildCanonicalContext, canonicalJson, contextHash, modelId, PROMPT_VERSION_EXTRACT } from "./context";
import { serveDayExtraction } from "./extract";
import { runGrouping, type GroupMember } from "./group";
import { subtopicKey } from "@/domain/subtopic";
import {
  renderMonthSummary,
  renderWeekSummary,
  type SummaryGroup,
} from "@/domain/summary-render";
import type { DayText } from "./extraction-checks";
import { parseActivities } from "@/domain/worklog-activities";
import { toDateOnly } from "@/server/time/workday";

/** One subtopic inside a topic. Sessions only — see the note on `GroupRollup`. */
export type SubtopicRollup = {
  name: string;
  sessions: number | null;
  /** The text's own noun, taken from the first member that supplied one. */
  sessions_unit: string | null;
  item_count: number;
};

export type GroupRollup = {
  name: string;
  /** How many extracted items fell into this group. */
  item_count: number;
  /** Null when no member stated a count. Never zero-for-unknown. */
  sessions: number | null;
  /** Null when no member stated a duration. Never zero-for-unknown. */
  minutes: number | null;
  sessions_unit: string | null;
  /** Distinct dates the members came from. */
  day_count: number;
  /**
   * What this topic covered, ordered by sessions descending.
   *
   * Sessions but NO duration, deliberately. A duration is stated per activity,
   * and rolling it to subtopic level would print the same minutes twice — once
   * on the topic line and again spread beneath it — inviting a reader to add
   * the second set and find they do not match the first.
   */
  subtopics: SubtopicRollup[];
  /**
   * The members themselves, for a group that has no topic to summarise.
   *
   * `Other` lists what it holds because "two entries" tells a reader nothing;
   * a named topic does not, because its subtopics already say what it covered.
   */
  entries: string[];
};

export type PeriodRollup = {
  /**
   * The period in words — two lines for a week, up to three for a month.
   *
   * Assembled from the groups below, whose every figure was summed here from
   * the stored day rows. The model named the groups and counted nothing.
   */
  summary_lines: string[];
  groups: GroupRollup[];
  total_minutes: number;
  unallocated_minutes: number;
  days_logged: number;
};

/** Anything the grouping could not name is collected here, and sorts last. */
export const OTHER = "Other";

type ProviderCall = (
  instruction: string,
) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>;

/**
 * Ensure every day in the period has a current extraction, extracting only the
 * ones that are missing or stale.
 *
 * This is what makes a week cost one call rather than six on the common path:
 * the days were already extracted when the instructor looked at them.
 */
export async function ensureDayExtractions(input: {
  instructorId: string;
  periodStart: string;
  periodEnd: string;
  call?: ProviderCall;
}) {
  const context = await buildCanonicalContext({
    instructorId: input.instructorId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });

  const out: Array<{ date: string; items: unknown; unallocatedMinutes: number; status: string }> = [];
  for (const row of context.days) {
    const day: DayText = {
      deliverable: row.deliverable ?? "",
      deliverableQuantity: row.deliverable_quantity,
      workingMinutes: row.working_minutes ?? 0,
      // Present only on a day entered as rows. Its presence is what turns off
      // the checks that exist to attribute numbers to text.
      activities: parseActivities(row.activities),
    };
    /* Hashed over the DAY alone, exactly as the day path hashes it, so a day
       already extracted for its own view is a day this does not pay for. A hash
       computed over the period would match nothing and re-extract everything. */
    const single = await buildCanonicalContext({
      instructorId: input.instructorId,
      periodStart: row.log_date,
      periodEnd: row.log_date,
    });
    const sourceHash = contextHash(canonicalJson(single), PROMPT_VERSION_EXTRACT, modelId());

    const stored = await serveDayExtraction({
      instructorId: input.instructorId,
      logDate: toDateOnly(row.log_date),
      day,
      sourceHash,
      call: input.call,
    });
    out.push({
      date: row.log_date,
      items: stored.items,
      unallocatedMinutes: stored.unallocatedMinutes,
      status: stored.status,
    });
  }
  return out;
}

type Item = {
  label: string;
  subtopic: string | null;
  topic: string | null;
  sessions: number | null;
  sessions_unit?: string | null;
  minutes: number | null;
};

/** The text's own noun, from whichever member stated one. Never chosen here. */
const unitOf = (ms: Item[]) => ms.find((m) => m.sessions_unit)?.sessions_unit ?? null;

/**
 * Group the period's items and sum each group in code.
 *
 * `call` is injected so a test can count provider calls; the caller in the
 * route passes nothing and gets the real provider.
 */
export async function buildPeriodRollup(input: {
  instructorId: string;
  periodStart: string;
  periodEnd: string;
  /** Which shape the sentence takes. A month gets a third line; a week does not. */
  scope?: "WEEK" | "MONTH";
  call?: ProviderCall;
}): Promise<{ ok: true; rollup: PeriodRollup } | { ok: false; reason: string }> {
  const days = await ensureDayExtractions(input);

  const context = await buildCanonicalContext({
    instructorId: input.instructorId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  const totalMinutes = context.days.reduce((n, d) => n + (d.working_minutes ?? 0), 0);
  const daysLogged = context.days.length;
  const unallocated = days.reduce((n, d) => n + d.unallocatedMinutes, 0);

  /* Labels and dates only. Everything else stays here. */
  const members: GroupMember[] = [];
  const items: Array<Item & { date: string }> = [];
  for (const day of days) {
    for (const raw of (day.items as Item[] | null) ?? []) {
      items.push({ ...raw, date: day.date });
      /* Labels, dates, and the topic each DAY named — no durations, no counts.
         The period's one name for a topic is the grouping's decision, because
         only it sees every day at once. */
      members.push({
        label: raw.label,
        date: day.date,
        subtopic: raw.subtopic ?? null,
        topic: raw.topic ?? null,
      });
    }
  }

  const grouped = await runGrouping(members, input.call);
  if (!grouped.ok) return { ok: false, reason: grouped.reason };

  const groups: GroupRollup[] = grouped.groups.map((g) => {
    const mine = g.members.map((i) => items[i]!);
    const sessions = mine.filter((m) => m.sessions !== null);
    const minutes = mine.filter((m) => m.minutes !== null);

    /* Subtopics summed here, in code, from the members — like every other
       figure on this screen. The model named them; it counted nothing. */
    /* Keyed on the equivalence, displayed under the first spelling seen. "AVL
       trees" and "AVL tree" are one line; "AVL trees" and "binary trees" are
       two, because they were two sessions and folding them would understate a
       count a reader can check. */
    const bySubtopic = new Map<string, { display: string; items: Item[] }>();
    for (const m of mine) {
      if (!m.subtopic) continue;
      const key = subtopicKey(m.subtopic);
      const existing = bySubtopic.get(key);
      if (existing) existing.items.push(m);
      else bySubtopic.set(key, { display: m.subtopic, items: [m] });
    }
    const subtopics: SubtopicRollup[] = [...bySubtopic.values()]
      .map(({ display: name, items: ms }) => {
        const stated = ms.filter((m) => m.sessions !== null);
        return {
          name,
          item_count: ms.length,
          sessions: stated.length ? stated.reduce((n, m) => n + (m.sessions ?? 0), 0) : null,
          sessions_unit: unitOf(ms),
        };
      })
      .sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0) || b.item_count - a.item_count);

    return {
      name: g.name,
      subtopics,
      /* Only `Other` lists its members: a named topic is described by its
         subtopics, and repeating the labels underneath would be the day view
         again. */
      entries: g.name === OTHER ? mine.map((m) => m.label) : [],
      item_count: mine.length,
      /* Null rather than zero when nobody stated one. Zero is a count somebody
         made; null is a count nobody made, and a screen that shows 0 for the
         second is asserting something the record does not say. */
      sessions: sessions.length ? sessions.reduce((n, m) => n + (m.sessions ?? 0), 0) : null,
      sessions_unit: unitOf(mine),
      minutes: minutes.length ? minutes.reduce((n, m) => n + (m.minutes ?? 0), 0) : null,
      day_count: new Set(mine.map((m) => m.date)).size,
    };
  });

  /* ── The closing check ─────────────────────────────────────────────────── */
  const groupMinutes = groups.reduce((n, g) => n + (g.minutes ?? 0), 0);
  if (groupMinutes + unallocated !== totalMinutes) {
    return {
      ok: false,
      reason:
        `groups account for ${groupMinutes} minutes and ${unallocated} unallocated, ` +
        `which is not the ${totalMinutes} the period recorded`,
    };
  }

  /* Ordered here, after the model has answered, so the order is a property of
     the figures rather than of what the model happened to list first. */
  groups.sort((a, b) => {
    if (a.name === OTHER) return 1;
    if (b.name === OTHER) return -1;
    return (
      (b.minutes ?? 0) - (a.minutes ?? 0) ||
      (b.sessions ?? 0) - (a.sessions ?? 0) ||
      b.day_count - a.day_count
    );
  });

  /* The sentence, written here. The model named the groups; every figure in
     the words below was summed above, from the rows. */
  const summaryGroups: SummaryGroup[] = groups.map((g) => ({
    name: g.name,
    count: g.sessions,
    unit: g.sessions_unit,
    minutes: g.minutes ?? 0,
    days: g.day_count,
    subtopics: g.subtopics.map((s) => s.name),
  }));
  const render = input.scope === "MONTH" ? renderMonthSummary : renderWeekSummary;

  return {
    ok: true,
    rollup: {
      summary_lines: render(summaryGroups, totalMinutes),
      groups,
      total_minutes: totalMinutes,
      unallocated_minutes: unallocated,
      days_logged: daysLogged,
    },
  };
}
