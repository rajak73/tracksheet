/**
 * Worklog summarisation — one prompt, three levels.
 *
 * The instructor writes what they did in whatever way they write: shorthand,
 * Hinglish, missing verbs, three activities on one line, "oops" for OOPs. This
 * turns that into one factual, manager-readable paragraph.
 *
 * ── One prompt, not three ─────────────────────────────────────────────────
 * `summaryLevel` is a field in the payload rather than a different prompt per
 * scope. Three prompts drift: a rule tightened for the day is forgotten for the
 * month, and nobody notices because nobody reads all three at once.
 *
 * ── What the model is for, and what it is not ─────────────────────────────
 * It is for language alone: reading messy text, keeping the writer's action,
 * naming the topic, and writing a short activity phrase. It is never asked for
 * a duration or a count. The minutes are attached in code from the row the
 * phrase came from, which is why there is nothing here for a figure to be
 * wrong about.
 */
import { graniteStructured } from "@/server/ai/workers-ai";
import { generateStructured } from "@/server/ai/gemini";

export type SummaryLevel = "DAILY" | "WEEKLY" | "MONTHLY";

/** One activity as the instructor filed it. Nothing derived, nothing tidied. */
export type SummaryActivityInput = {
  text: string;
  /** What they counted, where they counted anything. */
  quantity: number | null;
  hours: number | null;
  minutes: number | null;
};

export type SummaryDayInput = {
  date: string;
  activities: SummaryActivityInput[];
  remarks: string;
};

/**
 * One line of the insight, as the screen renders it: `• {activity} - {duration}`.
 *
 * `durationMinutes` is 0 where the activity has no duration of its own — a set
 * of activities sharing one reported total, where splitting it would be a
 * guess. Zero means "no figure to show", never "took no time".
 */
/**
 * The semantic structure behind a label, where the text supports it.
 *
 * ── Why these are stored and not just the phrase ──────────────────────────
 * A week and a month have to group related work, and grouping on the rendered
 * phrase can only match strings. With the action and the subject held apart,
 * the same grouping is arithmetic: same action plus same subject is one line,
 * and the topics under it are a set union. That is a decision code can make
 * correctly every time, so it is made in code and the model is not asked again.
 *
 * ── These are not a taxonomy ──────────────────────────────────────────────
 * Every value is free text the model read out of the worklog. There is no list
 * to choose from, nothing is validated against a vocabulary, and two people
 * describing the same work differently is a correct outcome. `subject` is null
 * whenever a broader one would be a guess — "sets class" names a topic and no
 * subject, and inventing Mathematics or Python there would be inventing the
 * most consequential field.
 */
export type InsightSemantics = {
  /** The verb: Teaching, Learning, Preparing, Reviewing, Meeting. */
  action: string | null;
  /** The broad area, ONLY where the text strongly supports one. */
  subject: string | null;
  topics: string[];
  subtopics: string[];
};

export type InsightItem = InsightSemantics & {
  activity: string;
  durationMinutes: number;
  /**
   * The raw line this was read from.
   *
   * Internal, never rendered. It is how the next normalisation recognises a
   * line whose words did not change, so an edit that only moved a duration or
   * deleted a different row costs no model call. Keyed on the words rather than
   * the position, because rows carry no id and a reorder would otherwise
   * invalidate work nobody touched.
   */
  sourceText?: string;
  /**
   * Which row of the day this came from.
   *
   * Internal, never rendered. `sourceText` alone cannot tell two identical
   * lines apart, and a day may legitimately hold the same sentence twice with
   * different durations. Without this, both occurrences collapse into one list
   * and every one of them is treated as a multi-phrase row — which set every
   * duration to zero and lost the day.
   */
  sourceIndex?: number;
};

/**
 * Stage A — what did this person do?
 *
 * ── Why this prompt is short ──────────────────────────────────────────────
 * It used to be one call asking for six things at once: the phrase, the action,
 * the subject, the topics, the subtopics and the source ids. Granite reversed
 * the action under that load — "learned java inheritance polymorphism" came
 * back as "Teaching Java" — and it had preserved the action reliably when its
 * whole job was writing a phrase.
 *
 * So the fix is less to do, not more rules. This asks for two fields about one
 * short line of text, and nothing else. The structure is somebody else's job.
 */
export const STAGE_A_SYSTEM = [
  "You rewrite ONE worklog line as a short professional activity phrase.",
  "",
  "THE RULE THAT MATTERS MOST: do not change the action.",
  "",
  "Whatever the person did, the phrase says that. Learning does not become",
  "teaching. Attending does not become conducting. Preparing does not become",
  "teaching. Reviewing does not become preparing.",
  "",
  '  "learned java inheritance polymorphism"',
  "    -> Learning Java: Inheritance and Polymorphism",
  '  "i took dsa class"          -> Teaching DSA',
  '  "attended dsa class"        -> Attending DSA Class',
  '  "prepared for dsa"          -> Preparing for DSA',
  '  "took doubt session class"  -> Doubt Resolution',
  '  "reviewed java assignment"  -> Reviewing Java Assignment',
  '  "worked on java"            -> Working on Java',
  '  "investigate intermittent OAuth token expiration errors"',
  "    -> Investigating OAuth Token Expiration Issues",
  "",
  "A class written with no verb at all was TAUGHT by the person writing it —",
  "they are recording their own work, and a class they merely sat in is written",
  '"attended". Only the word "attended" makes it attending.',
  "",
  '  "dsa class"                 -> Teaching DSA',
  '  "sets class"                -> Teaching Sets',
  '  "live class on binary search" -> Teaching Binary Search',
  '  "binary search lower bound upper bound class"',
  "    -> Teaching Binary Search: Lower Bound and Upper Bound",
  '  "attended dsa class"        -> Attending DSA Class',
  "",
  '"Took" is not "attended". Somebody who took a class ran it; somebody who',
  'attended one sat in it. This is the pair most often got backwards:',
  "",
  '  "i took dsa class"          -> Teaching DSA',
  '  "took java class"           -> Teaching Java',
  '  "took doubt session class"  -> Doubt Resolution',
  '  "attended dsa class"        -> Attending DSA Class',
  '  "attended mentor meeting"   -> Attending Mentor Meeting',
  "",
  "Write the verb as an -ing form: Fixing, not Fixed; Teaching, not Taught.",
  "",
  "Never infer the action from who the person is, or from any other line. Only",
  "this text decides. If the text does not say which action it was, keep the",
  'phrase general — "worked on DSA" is Working on DSA, not teaching or learning.',
  "",
  "Keep whatever topic the text names, and never invent one. Expect informal",
  "English, Hinglish, shorthand and spelling mistakes; read for meaning and fix",
  "the spelling silently.",
  "",
  "Begin the phrase with the verb, as every example above does.",
  "",
  "If the line truly holds several separate actions, return one item for each.",
  "",
  "No duration, no counts, no action field, no subject, no topics, no",
  "categories, no markdown, no explanation.",
  'Return only: {"items": [{"activity": "..."}]}',
].join("\n");

export const STAGE_A_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { activity: { type: "string" } },
        required: ["activity"],
      },
    },
  },
  required: ["items"],
} as const;

/**
 * Stage B — what was it about?
 *
 * Given a phrase Stage A has already settled, name the subject, topics and
 * subtopics behind it. It is shown the raw text for grounding only.
 *
 * It cannot change the phrase or the action: neither is in its output shape, so
 * there is nothing for it to overwrite. That is the guarantee — not an
 * instruction it might ignore, but a contract with no field to put it in.
 */
export const STAGE_B_SYSTEM = [
  "You are given an activity phrase that is already final, and the raw text it",
  "came from. Name the subject, topics and subtopics behind it.",
  "",
  "You cannot change the phrase and you cannot change the action. Neither is",
  "yours to return.",
  "",
  '  "Teaching Binary Search: Lower Bound and Upper Bound"',
  '    -> subject "DSA", topics ["Binary Search"],',
  '       subtopics ["Lower Bound", "Upper Bound"]',
  '  "Learning Java: Inheritance and Polymorphism"',
  '    -> subject "Java", topics ["OOP"], subtopics ["Inheritance", "Polymorphism"]',
  '  "Teaching Calculus: Limits and Continuity"',
  '    -> subject "Mathematics", topics ["Calculus"],',
  '       subtopics ["Limits", "Continuity"]',
  "",
  "`subject` is the broader area, and ONLY where the text strongly supports one.",
  "Null is the right answer far more often than a guess:",
  "",
  '  "Teaching Sets"      -> subject null, topics ["Sets"]',
  "     Sets could be mathematics, Python or set theory. Naming one invents the",
  "     most important field.",
  '  "Doubt Resolution"   -> subject null, topics [], subtopics []',
  '  "Meeting with Mentor"-> subject null, topics [], subtopics []',
  "",
  "Never take a subject from another activity, and never repeat the topic as the",
  "subject — a subject is broader than the topic under it, or it is null.",
  "",
  "There is no list to choose any of these from. Write what the text supports.",
  "",
  'Return only: {"subject": "..."|null, "topics": [...], "subtopics": [...]}',
].join("\n");

export const STAGE_B_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", nullable: true },
    topics: { type: "array", items: { type: "string" } },
    subtopics: { type: "array", items: { type: "string" } },
  },
  required: ["topics", "subtopics"],
} as const;

/**
 * A string field, or absent.
 *
 * The literal words are treated as absent too. A model asked for a nullable
 * field sometimes answers with the WORD instead of the value, and "null" then
 * travels all the way to a screen: a week's line read "Teaching null: Sets",
 * because a subject that was supposed to be missing was the four characters
 * spelling missing.
 */
const ABSENT = new Set(["null", "none", "n/a", "na", "undefined", "unknown", "-"]);

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const text = v.trim();
  return text === "" || ABSENT.has(text.toLowerCase()) ? null : text;
};

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];

/**
 * A subject only counts if it is broader than the topic it sits over.
 *
 * "sets class" came back with subject "Sets" and topics ["Sets"] — the topic
 * restated in the field meant for the area above it, which is exactly the
 * inference the rules forbid. It matters because a period groups on the
 * subject, so a phantom one becomes a heading two unrelated activities are
 * filed under.
 *
 * Deterministic and vocabulary-free: it compares the model's own two fields and
 * asks whether they say the same thing. Nothing here knows what a subject IS,
 * which is the point — a list of real subjects would be a taxonomy.
 */
export function broaderSubject(subject: string | null, topics: string[]): string | null {
  if (!subject) return null;
  const flat = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  return topics.some((topic) => flat(topic) === flat(subject)) ? null : subject;
}

export type ProviderCall = (
  instruction: string,
  system: string,
  schema: unknown,
  label?: string,
) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>;

/** The provider call. See the note on the switch. */
export const summaryCall: ProviderCall = (instruction, system, schema, label) => {
  const shared = {
    system,
    responseSchema: schema,
    label,
    /* Zero, so re-labelling unchanged text reads identically. Somebody
       comparing two screenshots of a day that did not change would otherwise
       have no way to tell a re-wording from an edit. */
    temperature: 0,
    maxOutputTokens: 512,
  };
  return process.env.SUMMARY_PROVIDER === "gemini"
    ? generateStructured(instruction, shared)
    : graniteStructured(instruction, shared);
};

/** One retry. A second refusal is a real problem with the text, not a blip. */
const ATTEMPTS = 2;

/** What Stage A settles: the phrase a person reads. */
export type LabelledActivity = { activity: string; action: string | null };

/**
 * The action, taken from the phrase Stage A already wrote.
 *
 * ── Why this is read and not asked for ───────────────────────────────────
 * Asking for it was the second regression. With `activity` and `action` side by
 * side in one object Granite stopped treating them as a phrase and its verb and
 * started treating them as two halves of a sentence: "learned java inheritance
 * polymorphism" came back as activity "Learning", action "Java Inheritance and
 * Polymorphism". Two adjacent text fields about the same thing is one field too
 * many for this model.
 *
 * So Stage A returns the phrase alone — the contract it has always handled —
 * and the verb is the word the phrase already begins with. This is not
 * classification and there is no vocabulary: it reads the model's own first
 * word. `aggregatePeriod` needs the action only as a grouping identity, and for
 * that a consistent reading of the phrase is exactly as good as a field, while
 * being impossible to contradict.
 */
export function actionOf(activity: string): string | null {
  const first = activity.trim().split(/[\s:]+/)[0];
  return first && first.length > 1 ? first : null;
}

/**
 * Stage A: label ONE worklog line.
 *
 * One line per call. A line holding several actions becomes several phrases,
 * and a batched call gives no way to know which phrase came from which line —
 * so the minutes on that line could not be attached without guessing.
 *
 * There are no source ids in this contract. The caller sent one line and knows
 * which it was, so the mapping is a fact rather than something a model is
 * trusted to carry back correctly.
 */
export async function labelText(
  text: string,
  call: ProviderCall = summaryCall,
): Promise<{ ok: true; activities: LabelledActivity[] } | { ok: false; reason: string }> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, activities: [] };

  let reason = "the model was never called";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const reply = await call(trimmed, STAGE_A_SYSTEM, STAGE_A_SCHEMA, `stage=A attempt=${attempt}`);
    if (!reply.ok) {
      reason = `provider: ${reply.reason}`;
      console.info(`[stage-a] attempt ${attempt}/${ATTEMPTS} — ${reason}`);
      continue;
    }
    try {
      const raw = (JSON.parse(reply.text) as { items?: unknown }).items;
      const activities: LabelledActivity[] = [];
      for (const entry of Array.isArray(raw) ? raw : []) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const activity = str(e.activity);
        if (activity) activities.push({ activity, action: actionOf(activity) });
      }
      if (activities.length > 0) return { ok: true, activities };
      reason = "the reply named no activity";
    } catch {
      reason = "the reply was not JSON";
    }
    console.info(`[stage-a] attempt ${attempt}/${ATTEMPTS} refused — ${reason}`);
  }
  return { ok: false, reason };
}

/**
 * Stage B: the structure behind a settled phrase.
 *
 * ── Failure is not failure ────────────────────────────────────────────────
 * Enrichment is optional. A refused reply, an outage, unparseable JSON — all of
 * them answer with nothing rather than throwing, and the day keeps Stage A's
 * phrase with no structure under it. A correct phrase with thin metadata beats
 * a wrong phrase with rich metadata, and the phrase is what a manager reads.
 *
 * ONE attempt, not two. The retry exists for the phrase, which matters; paying
 * twice for optional metadata is paying twice for something the caller is
 * already willing to do without.
 */
export type ActivityStructure = {
  subject: string | null;
  topics: string[];
  subtopics: string[];
};

const NO_STRUCTURE: ActivityStructure = { subject: null, topics: [], subtopics: [] };

export async function structureActivity(
  activity: string,
  rawText: string,
  call: ProviderCall = summaryCall,
): Promise<ActivityStructure> {
  const instruction = JSON.stringify({ activity, rawText }, null, 2);
  const reply = await call(instruction, STAGE_B_SYSTEM, STAGE_B_SCHEMA, "stage=B");
  if (!reply.ok) {
    console.info(`[stage-b] ${activity} — provider: ${reply.reason}`);
    return NO_STRUCTURE;
  }
  try {
    const parsed = JSON.parse(reply.text) as Record<string, unknown>;
    const topics = strings(parsed.topics);
    return {
      subject: broaderSubject(str(parsed.subject), topics),
      topics,
      subtopics: strings(parsed.subtopics),
    };
  } catch {
    console.info(`[stage-b] ${activity} — the reply was not JSON`);
    return NO_STRUCTURE;
  }
}
