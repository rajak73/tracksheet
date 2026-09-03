/**
 * Day extraction — turning a day's own words into checkable points.
 *
 * ── What the model is and is not asked to do ──────────────────────────────
 * It reads one day's text and reports what that text SAYS: the activities named
 * in it, how many of each where a count is written, and how long where a
 * duration is written. It does not count, convert, add, or infer. Every number
 * it returns must already be in the text, and the six checks refuse the
 * extraction if one is not.
 *
 * ── Why a duration has two fields ─────────────────────────────────────────
 * The prompt used to ask for `hours`. An instructor writing "checked 25 quiz
 * papers — 45 minutes" forces the model to answer 0.75, which appears nowhere
 * in the text, so provenance rejected it — correctly, and fatally, because in
 * real data most lines state minutes. Reporting `45` and `"minutes"` keeps both
 * halves honest: the number is quoted from the text, and the arithmetic happens
 * here, in code, afterwards.
 */
import { prisma } from "@/server/db";
import { Prisma } from "@/generated/prisma/client";
import { generateStructured } from "@/server/ai/gemini";
import {
  checkExtraction,
  durationMinutes,
  type CheckFailure,
  type DayText,
  type ExtractedActivity,
} from "./extraction-checks";
import { PROMPT_VERSION_EXTRACT, modelId, stableStringify } from "./context";
import type { ActivityRow } from "@/domain/worklog-activities";
import { parseSummary, summaryInstruction, type DaySummary } from "./day-summary";

/** One point as it is stored and rendered. */
export type ExtractedItem = {
  label: string;
  /** Quoted from the text. Null when nothing specific was named. */
  subtopic: string | null;
  /** Inferred from the subtopic. Null when the activity names no subject. */
  topic: string | null;
  /** The text's own noun for the count — "classes", "students". */
  sessions_unit?: string | null;
  sessions: number | null;
  /** Whole minutes, converted here from what the model reported. */
  minutes: number | null;
};

export type ExtractionResult =
  | {
      status: "READY";
      items: ExtractedItem[];
      unallocatedMinutes: number;
      /** How many stated numbers the text could not support. */
      nulled: number;
      /** The day in words. Null when the summarising call did not land. */
      summary: DaySummary | null;
    }
  | {
      status: "FAILED";
      lastError: string;
      /**
       * Which side failed.
       *
       * `structure` is the checks refusing what the model said about the text;
       * `provider` is never having got an answer. They read the same in a log
       * and mean opposite things on screen — one is a property of what was
       * written, the other is an outage.
       */
      failureKind: "structure" | "provider";
    };

/**
 * The day as the model sees it. Nothing derived, nothing tidied — the two free
 * text boxes and the recorded total, which is the only number the model is
 * given and the only one it is never asked to repeat.
 */
export function canonicalDay(day: DayText): string {
  return stableStringify({
    deliverable: day.deliverable,
    deliverable_quantity: day.deliverableQuantity,
    working_minutes: day.workingMinutes,
  });
}

/**
 * The instruction for an AUTHORED day — one the instructor entered as rows.
 *
 * ── What is not asked for ─────────────────────────────────────────────────
 * Any number. The quantity was typed into the row it belongs to and the
 * duration into the same row, so both are facts already, and asking a model to
 * restate a fact is how a second version of it comes into existence.
 *
 * The remaining job is language: shorten the description into a label, name the
 * subtopic it mentions, infer the topic that subtopic belongs to.
 */
export function rowExtractionInstruction(rows: ActivityRow[]): string {
  return [
    "Below is a list of activities somebody recorded today, as JSON. Each has",
    "an index and the description they wrote.",
    "",
    "For each one, report:",
    "- label: the description shortened to its essential phrase, in the",
    "  writer's own words. KEEP THE VERB: \"learned Java and OOPs concepts\", not",
    '  "Java and OOPs concepts" — a reader must be able to tell teaching from',
    "  learning without opening the source. Do not expand something already",
    '  short: "Corrected" stays "Corrected".',
    "- subtopic: the specific thing it was about, taken from the description.",
    '  "Live class on binary search" has subtopic "binary search". Null if the',
    "  description names nothing specific.",
    "- topic: the broader area that subtopic belongs to. The description does",
    '  NOT need to name it: "i took avl tree class" names only AVL trees, which',
    '  belong to "DSA", so the topic is "DSA". Null when the activity names no',
    '  subject matter — "Doubt clearing session", "Office meeting", "Corrected".',
    "",
    "Rules:",
    "- Report no numbers at all. The counts and durations are already known.",
    "- Never invent a subtopic that is not in the description. topic may be",
    "  inferred; subtopic may not.",
    "- Merge two subtopics only when they clearly name the same thing (\"AVL",
    '  trees" and "AVL tree"). Never merge a narrower one into a broader one.',
    "- Return exactly one entry per index, in the same order.",
    "",
    ...summaryInstruction().split("\n"),
    "",
    'Reply with exactly this JSON and nothing else: {"activities": [{"label":',
    '"<text>", "subtopic": "<text>"|null, "topic": "<text>"|null}],',
    '"bullets": [{"activities": [<index>, ...], "text": "<sentence>"}],',
    '"insight": "<one sentence>"}',
    "",
    stableStringify(rows.map((r, i) => ({ index: i, description: r.description }))),
  ].join("\n");
}

/** Bump `PROMPT_VERSION_EXTRACT` in `context.ts` whenever this text changes. */
export function extractionInstruction(day: DayText): string {
  return [
    "Below is one day of work somebody recorded, as JSON. Report what the text",
    "SAYS. Do not interpret, summarise, judge, or calculate.",
    "",
    "For each activity the text names, report:",
    "- label: the activity shortened to its essential phrase, in the writer's",
    "  own words and without the numbers. \"Investigate intermittent OAuth token",
    '  expiration errors for enterprise users and admin" becomes "OAuth token',
    '  expiration debugging". Do not add words that change what it says, and do',
    '  not expand something that is already short: "Corrected" stays "Corrected".',
    "- subtopic: the specific thing this activity was about, taken from the",
    '  text. "Live class on binary search" has subtopic "binary search". If the',
    "  text names nothing specific, subtopic is null.",
    "- topic: the broader area the subtopic belongs to. \"binary search\" and",
    '  "binary trees" belong to "DSA". "list comprehension" belongs to "Python".',
    "  Name it in the shortest form that a reader would recognise.",
    "- sessions: how many of the thing the text says. Null if it does not say.",
    "- sessions_unit: the noun the text uses for that count — \"classes\",",
    '  "students", "papers". Null if the text gives no noun. Never invent one.',
    "- duration_value and duration_unit: how long the text says this activity",
    '  took, in the unit the text uses. "45 minutes" is 45 and "minutes".',
    '  "2 hours" is 2 and "hours". "1.5 hours" is 1.5 and "hours". If the text',
    "  states no duration, both are null.",
    "",
    "Rules:",
    "- The text does NOT need to name the topic. \"i took avl tree class\" names",
    '  only AVL trees, which belong to DSA, so topic is "DSA". Infer the topic',
    "  from what the subtopic IS, not from whether the writer happened to put",
    "  the area's name in the sentence.",
    "- Only name a topic you are confident about from the subtopic itself. If",
    '  the activity names no subject matter — "Doubt clearing session", "Office',
    '  meeting", "Corrected" — topic is null.',
    "- Merge two subtopics only when they clearly name the same thing (\"AVL",
    '  trees" and "AVL tree"). Never merge a narrower subtopic into a broader',
    '  one: "AVL trees" and "binary trees" stay separate, because they were',
    "  separate sessions.",
    "- Never invent a subtopic that is not in the text. topic may be inferred;",
    "  subtopic may not.",
    "- Prefer null over a guess. An activity with no topic is displayed on its",
    "  own and that is a correct outcome, not a gap.",
    "- Never convert between units. Never add durations together. Report what is",
    "  written.",
    "- A clock time or a time range states WHEN something happened, not how long",
    '  it took. Never derive a duration from "9:00 AM to 11:00 AM" or "5 to 6".',
    "  If no duration is stated, both fields are null.",
    "- Every number you report must appear in the text, next to the activity it",
    "  belongs to. If you cannot find it there, use null.",
    "- One number cannot be both a count and a duration. If the text says",
    '  "1 hour", that is a duration and sessions is null.',
    "- Do not use working_minutes for anything. It is the day's recorded total,",
    "  given for context, and it is never an activity's duration.",
    "- deliverable_quantity describes the WHOLE day. If you report more than one",
    "  activity, take no count from it at all — it is a list joined to the",
    "  descriptions by nothing but order, and matching them up guesses. Take",
    "  counts from the deliverable text, where each number sits beside the",
    "  activity it belongs to. If you report exactly one activity, the quantity",
    "  box refers to that activity and its number may be used.",
    "",
    ...summaryInstruction().split("\n"),
    "",
    'Reply with exactly this JSON and nothing else: {"activities": [{"label":',
    '"<text>", "subtopic": "<text>"|null, "topic": "<text>"|null,',
    '"sessions": <number|null>, "sessions_unit": "<text>"|null,',
    '"duration_value": <number|null>,',
    '"duration_unit": "hours"|"minutes"|null}], "bullets": [{"activities":',
    '[<index>, ...], "text": "<sentence>"}], "insight": "<one sentence>"}',
    "",
    canonicalDay(day),
  ].join("\n");
}

/**
 * The model's reply, or null when it is not the shape that was asked for.
 *
 * A malformed reply is not a check failure — the checks answer "is this
 * extraction true of the text", and there is no extraction here to ask that of.
 * It is retried like any other bad call.
 */
export function parseExtraction(text: string): ExtractedActivity[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const activities = (parsed as { activities?: unknown }).activities;
  if (!Array.isArray(activities)) return null;

  const out: ExtractedActivity[] = [];
  for (const raw of activities) {
    if (typeof raw !== "object" || raw === null) return null;
    const a = raw as Record<string, unknown>;
    if (typeof a.label !== "string") return null;

    const subtopic = a.subtopic ?? null;
    if (subtopic !== null && typeof subtopic !== "string") return null;
    const topic = a.topic ?? null;
    if (topic !== null && typeof topic !== "string") return null;

    const sessionsUnit = a.sessions_unit ?? null;
    if (sessionsUnit !== null && typeof sessionsUnit !== "string") return null;

    const sessions = a.sessions ?? null;
    if (sessions !== null && typeof sessions !== "number") return null;

    const value = a.duration_value ?? null;
    if (value !== null && typeof value !== "number") return null;

    const unit = a.duration_unit ?? null;
    if (unit !== null && unit !== "hours" && unit !== "minutes") return null;

    /* A value without a unit cannot be converted and a unit without a value
       measures nothing. Either is a reply that did not answer the question. */
    if ((value === null) !== (unit === null)) return null;

    out.push({
      label: a.label,
      /* Blank is null. A model asked for "the specific thing" and given nothing
         to point at will sometimes answer with an empty string, and an empty
         string is a value where null is the fact. */
      subtopic: typeof subtopic === "string" && subtopic.trim() !== "" ? subtopic.trim() : null,
      topic: typeof topic === "string" && topic.trim() !== "" ? topic.trim() : null,
      sessions_unit:
        typeof sessionsUnit === "string" && sessionsUnit.trim() !== "" ? sessionsUnit.trim() : null,
      sessions: sessions as number | null,
      duration_value: value as number | null,
      duration_unit: unit as "hours" | "minutes" | null,
    });
  }
  return out;
}

const describe = (failures: CheckFailure[]) =>
  failures.map((f) => `check ${f.check}: ${f.reason}`).join("; ");

/**
 * Call, check, and convert. One retry, then FAILED.
 *
 * Never returns a partial extraction: either every activity passed all six
 * checks, or the day is FAILED and renders its raw text. A day that kept the
 * activities that happened to pass would be a reading of the record that nobody
 * can reproduce from the record.
 */
export async function runExtraction(
  day: DayText,
  call: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>
    = (i) => generateStructured(i, { maxOutputTokens: 2048 }),
): Promise<ExtractionResult> {
  const rows = day.activities ?? null;
  const instruction = rows ? rowExtractionInstruction(rows) : extractionInstruction(day);
  let lastError = "the model was never called";
  let failureKind: "structure" | "provider" = "provider";

  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call(instruction);
    if (!reply.ok) {
      lastError = `provider: ${reply.reason}`;
      failureKind = "provider";
      continue;
    }
    const activities = parseExtraction(reply.text);
    if (!activities) {
      lastError = "the reply was not the shape the prompt asked for";
      failureKind = "structure";
      continue;
    }
    /* On an authored day the model returned language only, so the numbers are
       attached here from the rows it was describing — by index, which is why
       the prompt insists on one entry per index in order. A reply of the wrong
       length is a reply to a different question. */
    if (rows && activities.length !== rows.length) {
      lastError = `the reply described ${activities.length} activities for ${rows.length} rows`;
      failureKind = "structure";
      continue;
    }
    const withNumbers: ExtractedActivity[] = rows
      ? activities.map((a, i) => ({
          ...a,
          sessions: rows[i]!.quantity,
          duration_value: rows[i]!.minutes,
          duration_unit: "minutes" as const,
        }))
      : activities;

    const checked = checkExtraction(withNumbers, day);
    if (!checked.ok) {
      lastError = describe(checked.failures);
      failureKind = "structure";
      console.info(`[extract] attempt ${attempt + 1} refused — ${lastError}`);
      continue;
    }
    /* Logged, not swallowed. Nulling an unattributable number is the right
       outcome for a day whose format cannot support attribution, and it is the
       WRONG outcome to accept quietly at scale — a rising rate here means the
       model is guessing, and nobody can see that from a screen full of dashes. */
    for (const n of checked.nulled) {
      console.info(
        `[extract] nulled ${n.field}=${n.value} (${n.reason}) for ${JSON.stringify(n.label)} ` +
          `— looked in ${JSON.stringify(n.segments)}`,
      );
    }

    /* Read from the SAME reply. A day already costs one call, and asking twice
       would double the bill of every screen in a product whose caching, manager
       gate and bounded page-load queue all exist to avoid exactly that.
       
       A summary that fails validation costs the sentence, not the extraction:
       the points still render, because what the text SAYS was already checked
       and is not in doubt because the prose about it was refused. */
    const summarised = parseSummary(
      reply.text,
      checked.activities.length,
      checked.activities.map((a) => ({ label: a.label, sessions: a.sessions })),
    );
    if (!summarised.ok) console.info(`[summary] not written — ${summarised.reason}`);

    return {
      status: "READY",
      summary: summarised.ok ? summarised.summary : null,
      /* `checked.activities`, not the model's. This is the whole point of the
         change: what is stored is what the text supports, which is the model's
         answer with the unsupported numbers removed. */
      items: checked.activities.map((a) => ({
        label: a.label.trim(),
        subtopic: a.subtopic,
        topic: a.topic,
        sessions_unit: a.sessions_unit,
        sessions: a.sessions,
        // The one conversion, in code, after the stated number has been checked.
        minutes: durationMinutes(a),
      })),
      unallocatedMinutes: checked.unallocatedMinutes,
      nulled: checked.nulled.length,
    };
  }
  return { status: "FAILED", lastError, failureKind };
}

/**
 * Serve a day's extraction, extracting only when the stored one is stale.
 *
 * Single-flight on `(instructorId, logDate)` through a transaction-scoped
 * advisory lock, for the reason `serveInsight` gives: two viewers opening the
 * same uncached day would otherwise both pay for it. A database lock rather
 * than an in-process one, because the app runs more than one instance.
 */
export async function serveDayExtraction(input: {
  instructorId: string;
  logDate: Date;
  day: DayText;
  sourceHash: string;
  /** Injected so tests can count calls without a provider. */
  call?: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
}) {
  const existing = await prisma.dayExtraction.findUnique({
    where: { instructorId_logDate: { instructorId: input.instructorId, logDate: input.logDate } },
  });
  if (existing && existing.sourceHash === input.sourceHash) return existing;

  const lockKey = `extract:${input.instructorId}:${input.logDate.toISOString().slice(0, 10)}`;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      // Re-read inside the lock: whoever held it first may have written the
      // very row this call was about to pay for.
      const fresh = await tx.dayExtraction.findUnique({
        where: {
          instructorId_logDate: { instructorId: input.instructorId, logDate: input.logDate },
        },
      });
      if (fresh && fresh.sourceHash === input.sourceHash) return fresh;

      const result = await runExtraction(input.day, input.call);
      const common = {
        sourceHash: input.sourceHash,
        rawContext: JSON.parse(canonicalDay(input.day)) as object,
        promptVersion: PROMPT_VERSION_EXTRACT,
        modelId: modelId(),
      };
      const data =
        result.status === "READY"
          ? {
              ...common,
              status: "READY" as const,
              items: result.items,
              unallocatedMinutes: result.unallocatedMinutes,
              summary: (result.summary ?? Prisma.DbNull) as Prisma.InputJsonValue,
              lastError: null,
              failureKind: null,
            }
          : {
              ...common,
              status: "FAILED" as const,
              /* Deliberately empty. A FAILED day shows its raw text; storing
                 the activities that happened to pass would be storing a partial
                 extraction under a status that says there is none. */
              items: [],
              unallocatedMinutes: input.day.workingMinutes,
              summary: Prisma.DbNull,
              lastError: result.lastError,
              failureKind: result.failureKind,
            };

      return tx.dayExtraction.upsert({
        where: {
          instructorId_logDate: { instructorId: input.instructorId, logDate: input.logDate },
        },
        create: { instructorId: input.instructorId, logDate: input.logDate, ...data },
        update: data,
      });
    },
    { timeout: 60_000 },
  );
}
