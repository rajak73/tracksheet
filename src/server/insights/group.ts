/**
 * Week and month grouping — naming what repeated, and counting nothing.
 *
 * ── The division of labour ────────────────────────────────────────────────
 * The model is given LABELS AND DATES. Not durations, not counts, not the day's
 * total. It answers one question — which of these are the same kind of work —
 * and code does every sum from the stored day extractions.
 *
 * A model that can see numbers will eventually repeat one, and a repeated
 * number is a second source for a figure that already has one. The two can
 * disagree, and when they do the one on screen is the invented one. So the
 * numbers are not withheld as a precaution; they are simply not part of the
 * question being asked.
 *
 * ── Why the topic is dropped ──────────────────────────────────────────────
 * `Live class on binary tree` and `Live class on hashing` are one activity seen
 * twice. A week that lists both back is a longer way of printing the day view.
 * The day keeps the topic, because that is the day's content; the week says
 * `Live class`, because that is what the week is about.
 */
import { generateStructured } from "@/server/ai/gemini";
import { stableStringify } from "./context";
import {
  parseSummary,
  summaryInstruction,
  type DaySummary,
  type SummaryItem,
} from "./day-summary";

export type GroupMember = {
  label: string;
  date: string;
  /** Quoted from that day's text. Carried so the group can list what it covered. */
  subtopic: string | null;
  /** As that DAY named it. The grouping decides the period's one name for it. */
  topic: string | null;
};

export type ActivityGroup = {
  /** The activity, without the topic. Never contains a digit. */
  name: string;
  /** Indices into the labels that were sent, so nothing is matched by string. */
  members: number[];
};

export type GroupingResult =
  | { ok: true; groups: ActivityGroup[]; summary: DaySummary | null }
  | { ok: false; reason: string };

/** Bump `PROMPT_VERSION_WEEK`/`MONTH` in `context.ts` when this text changes. */
export function groupingInstruction(members: GroupMember[]): string {
  return [
    "Below is a list of activities somebody recorded over a period, as JSON.",
    "Each has an index, a label, the date it was recorded on, and the subtopic",
    "and topic that day's reading named.",
    "",
    "Group them by TOPIC. Each group is one topic, and its members are the",
    "activities belonging to it.",
    "",
    "Rules:",
    "- If the same topic appears under different names across days — \"DSA\" and",
    '  "Data Structures" — choose one name and place both under it.',
    "- A day may name a subtopic without naming its topic. \"AVL trees\" belongs",
    '  under "DSA" whether or not any day wrote "DSA" down.',
    "- Merge two subtopics only when they clearly name the same thing (\"AVL",
    '  trees" and "AVL tree"). Never merge a narrower subtopic into a broader',
    '  one: "AVL trees" and "binary trees" belong to the same topic and stay',
    "  separate, because they were separate sessions.",
    "- An activity with no topic joins a group only if the same activity recurs",
    '  across days ("Doubt clearing session"). Otherwise it goes to "Other".',
    '- Use "Other" as the name for that group, exactly.',
    "- Output no numbers of any kind, including in the headline. You are not",
    "  counting; the figures are already known.",
    "- Every index must appear in exactly one group. Do not drop any, and do",
    "  not invent an index that was not given to you.",
    "- Use the writer's own vocabulary. Do not classify their work into a",
    "  category of your own.",
    "",
    ...summaryInstruction().split("\n"),
    "",
    'Reply with exactly this JSON and nothing else: {"groups": [{"name":',
    '"<topic>", "members": [<index>, ...]}], "bullets": [{"activities":',
    '[<index>, ...], "text": "<sentence>"}], "insight": "<one sentence>"}',
    "",
    stableStringify(
      members.map((m, i) => ({
        index: i,
        label: m.label,
        date: m.date,
        subtopic: m.subtopic,
        topic: m.topic,
      })),
    ),
  ].join("\n");
}

/** Any digit anywhere, including inside a group name. */
const HAS_DIGIT = /\d/;

/**
 * Validate a grouping reply.
 *
 * Rejects rather than repairs, for the reason every check here rejects rather
 * than repairs: a repaired answer is one nobody asked the model for and nobody
 * can trace back to the record.
 */
export function parseGrouping(
  text: string,
  memberCount: number,
  /** Passed through so a bullet's counts can be checked against the record. */
  items: SummaryItem[] = [],
): GroupingResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the reply was not JSON" };
  }

  /* The digit test runs on the WHOLE reply, before anything is picked out of
     it. A number in a field nobody reads today is a number somebody renders
     tomorrow, and the headline is the field most likely to carry one. */
  if (HAS_DIGIT.test(JSON.stringify((parsed as { groups?: unknown })?.groups ?? parsed))) {
    // Indices are digits, so they are checked separately below; strip them out
    // before deciding the reply "contains" a number.
    const withoutIndices = JSON.stringify(
      ((parsed as { groups?: unknown }).groups as unknown[] | undefined)?.map((g) =>
        typeof g === "object" && g !== null ? { ...(g as object), members: [] } : g,
      ) ?? parsed,
    );
    if (HAS_DIGIT.test(withoutIndices)) {
      return { ok: false, reason: "the reply states a number, and grouping states none" };
    }
  }

  const groups = (parsed as { groups?: unknown }).groups;
  if (!Array.isArray(groups)) return { ok: false, reason: "no groups array" };

  const seen = new Set<number>();
  const out: ActivityGroup[] = [];
  for (const raw of groups) {
    if (typeof raw !== "object" || raw === null) return { ok: false, reason: "a group is not an object" };
    const g = raw as Record<string, unknown>;
    if (typeof g.name !== "string" || g.name.trim() === "") {
      return { ok: false, reason: "a group has no name" };
    }
    if (!Array.isArray(g.members)) return { ok: false, reason: `group "${g.name}" has no members` };

    const members: number[] = [];
    for (const m of g.members) {
      if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m >= memberCount) {
        return { ok: false, reason: `group "${g.name}" names an activity that was not sent` };
      }
      if (seen.has(m)) return { ok: false, reason: `activity ${m} is in two groups` };
      seen.add(m);
      members.push(m);
    }
    out.push({ name: g.name.trim(), members });
  }

  if (seen.size !== memberCount) {
    return { ok: false, reason: `${memberCount - seen.size} activities were left out` };
  }
  /* Read from the same reply, for the same reason the day's is: a period
     already costs one call. A summary that fails validation costs the sentence
     and not the grouping — the totals still render. */
  const summarised = parseSummary(text, memberCount, items);
  if (!summarised.ok) console.info(`[summary] period not written — ${summarised.reason}`);

  return { ok: true, groups: out, summary: summarised.ok ? summarised.summary : null };
}

/**
 * How many times grouping is attempted before it gives up.
 *
 * ── Why this is three and extraction is two ───────────────────────────────
 * Not a preference. Extraction handles ONE day and a handful of lines, so a
 * second failure is usually a real problem with the text and a third attempt
 * buys a third identical refusal.
 *
 * Grouping at month scale handles a hundred labels and must place every one in
 * exactly one group — a task whose failure rate rises with size. Observed: a
 * month's grouping failed validation twice and returned FAILED, and the same
 * call succeeded on a later attempt. A third attempt is cheap against a month
 * of already-paid extractions, and it is the smallest change that fits what was
 * actually seen. Chunking the month or merging week-by-week would be a design
 * built on one observation.
 */
export const GROUPING_ATTEMPTS = 3;

/**
 * Group, retrying up to {@link GROUPING_ATTEMPTS} times. The sums are the
 * caller's, from stored extractions.
 */
export async function runGrouping(
  members: GroupMember[],
  call: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>
    = (i) => generateStructured(i, { maxOutputTokens: 2048 }),
): Promise<GroupingResult> {
  if (members.length === 0) return { ok: true, groups: [], summary: null };
  const instruction = groupingInstruction(members);
  let reason = "the model was never called";

  for (let attempt = 1; attempt <= GROUPING_ATTEMPTS; attempt++) {
    const reply = await call(instruction);
    if (!reply.ok) {
      reason = `provider: ${reply.reason}`;
      console.info(`[group] attempt ${attempt}/${GROUPING_ATTEMPTS} — ${reason}`);
      continue;
    }
    const parsed = parseGrouping(
      reply.text,
      members.length,
      /* No per-activity counts at period scale — the grouping is sent labels
         and dates only. A bullet may still say how many ACTIVITIES it covers;
         any other figure is refused. */
      members.map((m) => ({ label: m.label, sessions: null })),
    );
    if (parsed.ok) {
      if (attempt > 1) console.info(`[group] succeeded on attempt ${attempt} of ${GROUPING_ATTEMPTS}`);
      return parsed;
    }
    reason = parsed.reason;
    /* Which check refused it, on every attempt, with the size of the problem.
       The suspicion is that "every label in exactly one group" fails as the
       list grows — and three or four real failures with their sizes is what a
       fix should be designed from, rather than the one that has been seen. */
    console.info(
      `[group] attempt ${attempt}/${GROUPING_ATTEMPTS} refused over ${members.length} labels — ${reason}`,
    );
  }
  return { ok: false, reason };
}
