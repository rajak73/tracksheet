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

export type GroupMember = { label: string; date: string };

export type ActivityGroup = {
  /** The activity, without the topic. Never contains a digit. */
  name: string;
  /** Indices into the labels that were sent, so nothing is matched by string. */
  members: number[];
};

export type GroupingResult =
  | { ok: true; groups: ActivityGroup[] }
  | { ok: false; reason: string };

/** Bump `PROMPT_VERSION_WEEK`/`MONTH` in `context.ts` when this text changes. */
export function groupingInstruction(members: GroupMember[]): string {
  return [
    "Below is a list of activities somebody recorded over a period, as JSON.",
    "Each has a label and the date it was recorded on, and an index.",
    "",
    "Group them by WHAT THE ACTIVITY IS, ignoring the topic or subject.",
    '"Live class on binary tree" and "Live class on hashing" are the same',
    'activity: both are "Live class". Name the group after the activity alone.',
    "",
    "Rules:",
    "- The group name must NOT contain the topic. No subject, chapter, or",
    "  module name.",
    "- The group name must NOT contain any digit, and neither must anything",
    "  else you write. You are not counting; the figures are already known.",
    "- Every index must appear in exactly one group. Do not drop any, and do",
    "  not invent an index that was not given to you.",
    "- Use the writer's own vocabulary for the activity. Do not classify it",
    "  into a category of your own.",
    "",
    'Reply with exactly this JSON and nothing else: {"groups": [{"name":',
    '"<activity>", "members": [<index>, ...]}]}',
    "",
    stableStringify(members.map((m, i) => ({ index: i, label: m.label, date: m.date }))),
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
export function parseGrouping(text: string, memberCount: number): GroupingResult {
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
  return { ok: true, groups: out };
}

/**
 * Group, retrying once. The sums are the caller's, from stored extractions.
 */
export async function runGrouping(
  members: GroupMember[],
  call: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>
    = (i) => generateStructured(i, { maxOutputTokens: 2048 }),
): Promise<GroupingResult> {
  if (members.length === 0) return { ok: true, groups: [] };
  const instruction = groupingInstruction(members);
  let reason = "the model was never called";

  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call(instruction);
    if (!reply.ok) {
      reason = `provider: ${reply.reason}`;
      continue;
    }
    const parsed = parseGrouping(reply.text, members.length);
    if (parsed.ok) return parsed;
    reason = parsed.reason;
  }
  return { ok: false, reason };
}
