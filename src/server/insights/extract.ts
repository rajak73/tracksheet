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
import { generateStructured } from "@/server/ai/gemini";
import {
  checkExtraction,
  durationMinutes,
  type CheckFailure,
  type DayText,
  type ExtractedActivity,
} from "./extraction-checks";
import { PROMPT_VERSION_EXTRACT, modelId, stableStringify } from "./context";

/** One point as it is stored and rendered. */
export type ExtractedItem = {
  label: string;
  sessions: number | null;
  /** Whole minutes, converted here from what the model reported. */
  minutes: number | null;
};

export type ExtractionResult =
  | { status: "READY"; items: ExtractedItem[]; unallocatedMinutes: number }
  | { status: "FAILED"; lastError: string };

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

/** Bump `PROMPT_VERSION_EXTRACT` in `context.ts` whenever this text changes. */
export function extractionInstruction(day: DayText): string {
  return [
    "Below is one day of work somebody recorded, as JSON. Report what the text",
    "SAYS. Do not interpret, summarise, judge, or calculate.",
    "",
    "For each activity the text names, report:",
    "- label: what the activity was, in the writer's own words, without the",
    "  numbers. Do not invent a category or rename the work.",
    "- sessions: how many of the thing the text says. Null if it does not say.",
    "- duration_value and duration_unit: how long the text says this activity",
    '  took, in the unit the text uses. "45 minutes" is 45 and "minutes".',
    '  "2 hours" is 2 and "hours". "1.5 hours" is 1.5 and "hours". If the text',
    "  states no duration, both are null.",
    "",
    "Rules:",
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
    "",
    'Reply with exactly this JSON and nothing else: {"activities": [{"label":',
    '"<text>", "sessions": <number|null>, "duration_value": <number|null>,',
    '"duration_unit": "hours"|"minutes"|null}]}',
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
  const instruction = extractionInstruction(day);
  let lastError = "the model was never called";

  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await call(instruction);
    if (!reply.ok) {
      lastError = `provider: ${reply.reason}`;
      continue;
    }
    const activities = parseExtraction(reply.text);
    if (!activities) {
      lastError = "the reply was not the shape the prompt asked for";
      continue;
    }
    const checked = checkExtraction(activities, day);
    if (!checked.ok) {
      lastError = describe(checked.failures);
      continue;
    }
    return {
      status: "READY",
      items: activities.map((a) => ({
        label: a.label.trim(),
        sessions: a.sessions,
        // The one conversion, in code, after the stated number has been checked.
        minutes: durationMinutes(a),
      })),
      unallocatedMinutes: checked.unallocatedMinutes,
    };
  }
  return { status: "FAILED", lastError };
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
              lastError: null,
            }
          : {
              ...common,
              status: "FAILED" as const,
              /* Deliberately empty. A FAILED day shows its raw text; storing
                 the activities that happened to pass would be storing a partial
                 extraction under a status that says there is none. */
              items: [],
              unallocatedMinutes: input.day.workingMinutes,
              lastError: result.lastError,
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
