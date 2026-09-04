/**
 * Call 2 — group the period.
 *
 * One call per week or month, cached against the period's content hash. It
 * reuses the day labels already stored and never re-labels a day.
 *
 * ── The division of labour ────────────────────────────────────────────────
 * The model is given LABELS AND DATES. Not durations, not counts, not the
 * period's total. It answers one question — which of these are the same kind of
 * work — and code does every sum from the stored day extractions and writes
 * every sentence.
 *
 * A model that can see numbers will eventually repeat one, and a repeated
 * number is a second source for a figure that already has one. The two can
 * disagree, and when they do the one on screen is the invented one. So the
 * numbers are not withheld as a precaution; they are simply not part of the
 * question being asked.
 *
 * ── Why the subtopic is kept out of the name ──────────────────────────────
 * `Taught binary tree` and `Taught hashing` are one kind of work seen twice. A
 * week that lists both back is a longer way of printing the day view. The day
 * keeps the subtopic, because that is the day's content; the week says
 * `DSA — taught`, because that is what the week is about — and the subtopics
 * are listed underneath, counted here, from the rows.
 */
import { generateStructured } from "@/server/ai/gemini";
import { stableStringify } from "./context";

export type GroupMember = {
  label: string;
  date: string;
  /** Quoted from that day's text. Carried so the group can list what it covered. */
  subtopic: string | null;
  /** As that DAY named it. The grouping decides the period's one name for it. */
  topic: string | null;
};

export type ActivityGroup = {
  /** `"Topic — action"`, or the action alone. Never contains a digit. */
  name: string;
  /** Indices into the labels that were sent, so nothing is matched by string. */
  members: number[];
};

export type GroupingResult =
  | { ok: true; groups: ActivityGroup[] }
  | { ok: false; reason: string };

/**
 * The system instruction. Bump `PROMPT_VERSION_WEEK`/`MONTH` in `context.ts`
 * when this text changes — the version is inside the context hash, which is
 * what re-groups every period grouped under the old wording.
 */
export const GROUP_SYSTEM = [
  "You group labelled work activities across a period.",
  "",
  '- A group is a topic plus an action. "Taught binary search" and "Taught',
  '  hashing" are one group. "Taught binary search" and "Prepared a problem set',
  '  on binary search" are two groups, because teaching and preparing are',
  "  different work.",
  '- Name a group as "Topic — action" where a topic exists: "DSA — taught",',
  '  "Java — learned", "OS — taught". Where no topic exists, name it by the',
  '  action alone: "Doubt clearing", "Submission review", "Mock interviews".',
  "- Never put a subtopic in a group name.",
  '- If a topic appears under different names across days — "DSA" and "Data',
  '  Structures" — choose one name and place all of them under it.',
  "- An activity with no topic joins a group only if the same activity recurs",
  '  across days. Otherwise it goes to "Other", named exactly that.',
  "- members: the activities you placed in this group, by the index each was",
  "  given. Every index must appear in exactly one group. Do not drop any, and",
  "  do not invent an index that was not given to you.",
  "- Output no numbers of any kind, in any field. Counts and durations are",
  "  computed by the application.",
  "- Use the writer's own vocabulary. Do not classify their work into a",
  "  category of your own.",
].join("\n");

/** The period, as the model sees it: labels, dates, and what each day named. */
export function groupingInstruction(members: GroupMember[]): string {
  return [
    "Below are the activities somebody recorded over a period, as JSON. Each",
    "has an index, a label, the date it was recorded on, and the subtopic and",
    "topic that day's reading named.",
    "",
    'Reply with exactly this JSON and nothing else: {"groups": [{"name":',
    '"<Topic — action>", "members": [<index>, ...]}]}',
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

/** The shape the provider itself must return. Content is checked separately. */
export const GROUP_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          members: { type: "array", items: { type: "integer" } },
        },
        required: ["name", "members"],
      },
    },
  },
  required: ["groups"],
} as const;

/** Any digit anywhere, including inside a group name. */
const HAS_DIGIT = /\d/;

/** Case- and plural-insensitive, the same dumb rule the subtopics use. */
const stem = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");

/**
 * Does this group name carry one of the period's subtopics?
 *
 * A name that says "DSA — taught binary search" is the day view with a week's
 * heading on it, and it is wrong the moment a second subtopic joins the group.
 * Checked here rather than trusted to the instruction, because it is the rule
 * the model breaks most naturally: the subtopic is the most specific thing it
 * knows about the group, and specificity reads as helpfulness.
 *
 * Single-word subtopics only. A multi-word subtopic that happens to share one
 * word with an action — "review" in "code review" — would refuse a name the
 * instruction asked for, and the check that costs a correct answer is worse
 * than the one that misses an incorrect one.
 *
 * ── A subtopic that IS the topic is not a subtopic in the name ────────────
 * "Prepared for dsa" names the subtopic "dsa" and the topic "DSA" — the writer
 * named only the broad area, so the two are the same word. The instruction then
 * asks for "DSA — taught", and this check refused it for containing "dsa",
 * three attempts running, on every week and month in the product. What the rule
 * forbids is a name narrowed past its topic; a name that IS its topic is the
 * name that was asked for.
 */
function namesSubtopic(name: string, subtopics: string[]): string | null {
  const { topic } = splitName(name);
  const topicStem = topic ? stem(topic) : null;
  const words = new Set(name.split(/\s+/).map(stem).filter(Boolean));
  for (const subtopic of subtopics) {
    if (topicStem && stem(subtopic) === topicStem) continue;
    const parts = subtopic.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const key = parts.map(stem).join(" ");
    if (parts.length === 1 && words.has(key)) return subtopic;
    if (parts.length > 1 && name.toLowerCase().includes(subtopic.toLowerCase())) return subtopic;
  }
  return null;
}

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
  /** The period's subtopics, so a name carrying one can be refused. */
  subtopics: string[] = [],
): GroupingResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the reply was not JSON" };
  }

  /* The digit test runs on the WHOLE reply, before anything is picked out of
     it. A number in a field nobody reads today is a number somebody renders
     tomorrow, and the headline is the field most likely to carry one. Member
     indices are digits and are the one number the reply must carry, so they are
     stripped out before the question is asked and checked on their own below. */
  const groupsRaw = (parsed as { groups?: unknown }).groups;
  const withoutIndices = JSON.stringify(
    (groupsRaw as unknown[] | undefined)?.map((g) =>
      typeof g === "object" && g !== null ? { ...(g as object), members: [] } : g,
    ) ?? parsed,
  );
  if (HAS_DIGIT.test(withoutIndices)) {
    return { ok: false, reason: "the reply states a number, and grouping states none" };
  }

  if (!Array.isArray(groupsRaw)) return { ok: false, reason: "no groups array" };

  const seen = new Set<number>();
  const out: ActivityGroup[] = [];
  for (const raw of groupsRaw) {
    if (typeof raw !== "object" || raw === null) return { ok: false, reason: "a group is not an object" };
    const g = raw as Record<string, unknown>;
    if (typeof g.name !== "string" || g.name.trim() === "") {
      return { ok: false, reason: "a group has no name" };
    }
    const name = g.name.trim();
    const carried = namesSubtopic(name, subtopics);
    if (carried) {
      return { ok: false, reason: `group "${name}" names the subtopic "${carried}"` };
    }
    if (!Array.isArray(g.members)) return { ok: false, reason: `group "${name}" has no members` };

    const members: number[] = [];
    for (const m of g.members) {
      if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m >= memberCount) {
        return { ok: false, reason: `group "${name}" names an activity that was not sent` };
      }
      if (seen.has(m)) return { ok: false, reason: `activity ${m} is in two groups` };
      seen.add(m);
      members.push(m);
    }
    out.push({ name, members });
  }

  if (seen.size !== memberCount) {
    return { ok: false, reason: `${memberCount - seen.size} activities were left out` };
  }
  return { ok: true, groups: out };
}

/**
 * How many times grouping is attempted before it gives up.
 *
 * ── Why this is three and labelling is two ────────────────────────────────
 * Not a preference. Labelling handles ONE day and a handful of lines, so a
 * second failure is usually a real problem with the text and a third attempt
 * buys a third identical refusal.
 *
 * Grouping at month scale handles a hundred labels and must place every one in
 * exactly one group — a task whose failure rate rises with size. Observed: a
 * month's grouping failed validation twice and returned FAILED, and the same
 * call succeeded on a later attempt. A third attempt is cheap against a month
 * of already-paid labelling calls, and it is the smallest change that fits what
 * was actually seen. Chunking the month or merging week-by-week would be a
 * design built on one observation.
 */
export const GROUPING_ATTEMPTS = 3;

/** `"DSA — taught"` → topic `DSA`. No dash: no topic. */
function splitName(name: string): { topic: string | null } {
  const parts = name.split(/\s+[—–-]\s+/);
  return parts.length >= 2 && parts[0]!.trim() ? { topic: parts[0]!.trim() } : { topic: null };
}

/** The provider call, configured as the grouping task requires. */
export function groupCall(instruction: string) {
  return generateStructured(instruction, {
    system: GROUP_SYSTEM,
    responseSchema: GROUP_SCHEMA,
    // Zero, so a period re-grouped after a cache expiry groups identically.
    temperature: 0,
    // No `thinkingBudget` — see the measurement in `labelCall`. The chain's own
    // per-model `thinkingLevel` is what these models accept.
    maxOutputTokens: 1_200,
  });
}

/**
 * Group, retrying up to {@link GROUPING_ATTEMPTS} times. The sums are the
 * caller's, from stored extractions.
 */
export async function runGrouping(
  members: GroupMember[],
  call: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }> = groupCall,
): Promise<GroupingResult> {
  if (members.length === 0) return { ok: true, groups: [] };
  const instruction = groupingInstruction(members);
  const subtopics = [...new Set(members.map((m) => m.subtopic).filter((s): s is string => Boolean(s)))];
  let reason = "the model was never called";

  for (let attempt = 1; attempt <= GROUPING_ATTEMPTS; attempt++) {
    const reply = await call(instruction);
    if (!reply.ok) {
      reason = `provider: ${reply.reason}`;
      console.info(`[group] attempt ${attempt}/${GROUPING_ATTEMPTS} — ${reason}`);
      continue;
    }
    const parsed = parseGrouping(reply.text, members.length, subtopics);
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
