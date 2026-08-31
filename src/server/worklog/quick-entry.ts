import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { logActivity, updateActivity } from "@/server/activities/logger";
import { loadTaxonomy, type Taxonomy } from "@/server/worklog/taxonomy";
import { loadUniversityConfig } from "@/server/universities/config";
import { dayOfWeekFor } from "@/server/time/schedule-windows";
import { toDateOnly, zonedParts } from "@/server/time/workday";
import { deliverableFor, quantityWhenUnstated } from "@/domain/worklog-taxonomy";

/**
 * One line of the day, recorded from four fields.
 *
 * ── What the instructor fills in ──────────────────────────────────────────
 * What they produced, how many of it, how long it took, and anything worth
 * saying about it. That is the whole form. It replaces the older screen where
 * they wrote sentences about their day and a model read them.
 *
 * ── Where the fifth column comes from ─────────────────────────────────────
 * The client's sheet also has a Broad Category, and the form does not ask for
 * one — deliberately: the client's position is that a person's subject should
 * follow the work rather than be chosen from a menu. So the model still runs,
 * but on the deliverable text instead of a paragraph, and its job is narrower:
 * read "Build API for the user module" and answer with the category it belongs
 * to, the deliverable type from the closed list, and the subject.
 *
 * If it names no subject — and it is instructed to say nothing rather than
 * guess — the day inherits from the last office day that did. That rule lives
 * in `daySubjectsFor` and needs nothing from here.
 *
 * ── Why the times are computed rather than asked for ──────────────────────
 * The form asks for hours, not a clock range, and `ActivityLog` stores two
 * instants — duration is deliberately not a column, so that every reader
 * derives it the same way. So the hours are laid down on the day END TO END:
 * the first entry starts when the university's day starts, and each one after
 * it begins where the last finished.
 *
 * That is not decoration. The overlap rule refuses two entries occupying the
 * same minutes, and it is the rule that stops a day quietly holding fourteen
 * hours of work. Stacking every entry at the same start time would trip it on
 * the second row of every day.
 */

/** A day cannot hold more than this, whatever the form is told. */
const MAX_HOURS_PER_DAY = 24;

export type QuickEntryInput = {
  instructorId: string;
  universityId: string;
  /** YYYY-MM-DD in the university's zone. */
  date: string;
  /** What they produced, in their own words. Classified, never rewritten. */
  deliverable: string;
  /**
   * How many. `null` is the client's `?` — they did not say, and nobody is
   * going to decide for them. Different from 0, which is a count of none.
   */
  quantity: number | null;
  workingHours: number;
  remarks?: string | null;
  /**
   * The Quantity and Working Hours boxes for this entry, exactly as typed.
   *
   * Stored beside the parsed values, never instead of them: the number and the
   * clock range remain the authority for every total, and these are what the
   * table prints. Optional because callers with no boxes — a manager logging on
   * somebody's behalf, the importer — have nothing to record here, and a row
   * without them falls back to the computed figure.
   */
  rawQuantity?: string | null;
  rawWorkingHours?: string | null;
  /**
   * Set when EDITING an existing row. The overlap check ignores it — an entry
   * must never be reported as conflicting with itself — and the row is updated
   * in place rather than replaced, so its id, its audit trail and anything
   * pointing at it survive the edit.
   */
  activityId?: string;
  /**
   * A classification already made for this line.
   *
   * The caller supplies one when it is recording several entries at once: the
   * whole submission is classified in a single provider call rather than one
   * per line, so a rate limit part-way through cannot give one day's work two
   * different treatments. Omitted, this classifies the line itself.
   */
  classification?: Classification;
};

/** What the model made of the deliverable line. Every field may be absent. */
export type Classification = {
  activityTypeCode: string;
  deliverableTypeId: string | null;
  /** The same deliverable as a code, for the report taxonomy to read. */
  deliverableCode: string | null;
  broadCategoryId: string | null;
};

/**
 * Reads one deliverable line and answers with the columns the form does not ask
 * for.
 *
 * The single-entry twin of {@link classifyLines}, and provider-free for the
 * same reason: this runs when somebody EDITS one row, and an edit is a person
 * fixing something while watching the screen — the least forgivable place to
 * put a network call to a model.
 *
 * Never throws. A line that cannot be placed records as `OTHER` with no
 * subject, and the day inherits its Broad Category from the last one that had
 * a subject — the same answer a line naming no subject would have produced.
 */
async function classify(deliverable: string, quantity: number | null): Promise<Classification> {
  const [only] = await classifyLines([{ deliverable, quantity }]);
  return (
    only ?? {
      activityTypeCode: "OTHER",
      deliverableTypeId: null,
      deliverableCode: null,
      broadCategoryId: null,
    }
  );
}

/**
 * Where on the day this entry sits.
 *
 * After everything already recorded, and never before the university's day
 * starts. Returns wall-clock minutes in the university's own zone, which is
 * what `logActivity` takes.
 */
async function placeOnDay(
  input: QuickEntryInput,
  timezone: string,
  dayStartMinute: number,
): Promise<{ startMinute: number; endMinute: number }> {
  const existing = await prisma.activityLog.findMany({
    where: {
      instructorId: input.instructorId,
      workDate: toDateOnly(input.date),
      ...(input.activityId ? { id: { not: input.activityId } } : {}),
    },
    select: { endTime: true },
  });

  const lastEnd = existing.reduce((latest, row) => {
    const minute = zonedParts(row.endTime, timezone).minutesSinceMidnight;
    return minute > latest ? minute : latest;
  }, 0);

  const startMinute = Math.max(dayStartMinute, lastEnd);
  const endMinute = startMinute + Math.round(input.workingHours * 60);

  if (endMinute > 24 * 60) {
    throw new ApiError(
      400,
      "DAY_FULL",
      "That would run past midnight. This day already holds too many hours for another entry of that length.",
    );
  }
  return { startMinute, endMinute };
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * Classifies a whole submission's lines in ONE provider call.
 *
 * `parseBullets` already takes an array, so recording five entries was making
 * five calls where one would do — five times the latency and five chances to
 * be rate-limited part-way through, which would leave one day's work with two
 * different category treatments depending on where it stopped.
 *
 * Never throws, for the same reason `classify` does not: a provider outage
 * must not stop somebody recording their day. Every line falls back to `OTHER`
 * with no subject, which is exactly what a line naming no subject would have
 * produced anyway.
 */
/**
 * Words that say nothing about WHICH deliverable a line is.
 *
 * "Session", "work" and "task" appear in half the taxonomy's own labels, so
 * matching on them would make every line look like every deliverable.
 */
const NOISE = new Set([
  "a", "an", "the", "on", "for", "of", "and", "to", "with", "in", "at",
  "session", "sessions", "work", "task", "tasks", "my", "today", "todays",
]);

const normalise = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const significantWords = (text: string) =>
  normalise(text).split(" ").filter((w) => w.length > 1 && !NOISE.has(w));

/**
 * The deliverable a line names outright, or null.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Classification was one provider call per submission, always — five seconds
 * on a good day and half a minute on a bad one, on every press of Submit, to
 * decide that "Live Class" is a live class. The instructor is typing the
 * taxonomy's own vocabulary most of the time, because it is the vocabulary the
 * report prints back at them.
 *
 * So the obvious cases are settled here, in memory, and the provider is asked
 * only about text this cannot place. Nothing about the ANSWER changes — the
 * ids come from the same taxonomy the model's reply is resolved against.
 *
 * ── Two names per deliverable, and the second is the one people type ─────
 * The stored label is the taxonomy's own — "Student Query Resolution". The
 * report prints the CLIENT's name for the same thing — "Doubt Clearing" — and
 * that is the vocabulary an instructor has in front of them, so it is the one
 * they write back. Matching only the stored label missed the commonest lines
 * on the page. Both names are tried; `deliverableFor` is the same map the
 * report reads.
 *
 * ── Longest label wins ────────────────────────────────────────────────────
 * "Revision Class" and "Live Class" both match a line containing the first,
 * and the more specific one is the right answer. Word count is the tiebreak
 * rather than string length, so a two-word label beats a one-word label
 * regardless of spelling.
 */
function matchDeliverable(
  text: string,
  taxonomy: Taxonomy,
): { categoryCode: string; deliverableId: string; deliverableCode: string } | null {
  const haystack = normalise(text);
  const words = new Set(significantWords(text));
  if (words.size === 0) return null;

  let best: { categoryCode: string; deliverableId: string; deliverableCode: string } | null = null;
  let bestScore = 0;

  for (const deliverable of taxonomy.deliverableByCode.values()) {
    const names = [
      deliverable.label,
      deliverableFor(deliverable.code, deliverable.categoryCode).name,
    ];

    for (const name of names) {
      const labelWords = significantWords(name);
      if (labelWords.length === 0) continue;

      // The whole name as a phrase, or every significant word of it present.
      const hit = haystack.includes(normalise(name)) || labelWords.every((w) => words.has(w));
      if (!hit || labelWords.length <= bestScore) continue;

      bestScore = labelWords.length;
      best = {
        categoryCode: deliverable.categoryCode,
        deliverableId: deliverable.id,
        deliverableCode: deliverable.code,
      };
    }
  }

  return best;
}

/**
 * Places each line against the taxonomy, WITHOUT calling the model.
 *
 * ── Why nothing here talks to a provider any more ─────────────────────────
 * This used to hand the whole submission to Gemini whenever one line could not
 * be matched locally, and the instructor waited for it. Measured, that was
 * THIRTY-FOUR SECONDS for a save that does about a second of real work — on
 * the one screen every instructor uses every day, at the one moment they are
 * waiting to leave.
 *
 * A save is now a write and nothing else. Every line is matched against the
 * taxonomy in memory; a line that cannot be placed becomes OTHER, keeps the
 * exact words the instructor typed, and stays completely correctable from the
 * table afterwards. The reading of what the day MEANS still happens — it just
 * happens after the row is safely stored, off the critical path, and its
 * conclusions land in `AiInsight` rather than being held in front of a person
 * with a cursor blinking at them. See `analyseDay`.
 *
 * ── OTHER is an honest answer ─────────────────────────────────────────────
 * The alternative to guessing locally is guessing remotely, and the model was
 * wrong often enough to need correcting anyway. OTHER says "nobody has
 * classified this yet", which is true, is visible in the table, and is one
 * click to fix. A confident wrong category is none of those things.
 */
export async function classifyLines(
  lines: Array<{ deliverable: string; quantity: number | null }>,
): Promise<Classification[]> {
  const fallback: Classification = {
    activityTypeCode: "OTHER",
    deliverableTypeId: null,
    deliverableCode: null,
    broadCategoryId: null,
  };
  if (lines.length === 0) return [];

  try {
    const taxonomy = await loadTaxonomy();

    /* `broadCategoryId` stays null: the subject is a separate judgement from
     * the deliverable, `recordQuickEntry` carries it forward from the last day
     * that named one, and this does not attempt it. */
    return lines.map((line) => {
      const match = matchDeliverable(line.deliverable, taxonomy);
      if (!match) return fallback;
      return {
        activityTypeCode: match.categoryCode,
        deliverableTypeId: match.deliverableId,
        deliverableCode: match.deliverableCode,
        broadCategoryId: null,
      };
    });
  } catch {
    // The taxonomy could not be read. Every line still records, as OTHER.
    return lines.map(() => fallback);
  }
}

/** Records one line of the day. */
export async function recordQuickEntry(input: QuickEntryInput) {
  const deliverable = input.deliverable.trim();
  if (!deliverable) {
    throw new ApiError(400, "DELIVERABLE_REQUIRED", "Say what you worked on.");
  }
  if (!(input.workingHours > 0)) {
    throw new ApiError(400, "HOURS_REQUIRED", "Working hours must be more than zero.");
  }
  if (input.workingHours > MAX_HOURS_PER_DAY) {
    throw new ApiError(
      400,
      "HOURS_TOO_LONG",
      `A single entry may not exceed ${MAX_HOURS_PER_DAY} hours.`,
    );
  }
  if (input.quantity !== null && (!Number.isInteger(input.quantity) || input.quantity < 0)) {
    throw new ApiError(400, "QUANTITY_INVALID", "Quantity must be a whole number.");
  }

  const config = await loadUniversityConfig(input.universityId);
  const weekday = dayOfWeekFor(input.date, config.timezone);
  const hours = config.workingHours.find((h) => h.dayOfWeek === weekday);
  // A day the university does not work is still a day somebody may have worked,
  // so this places the entry rather than refusing it. 09:00 is the stand-in.
  const dayStartMinute = hours?.startMinute ?? 9 * 60;

  const { startMinute, endMinute } = await placeOnDay(input, config.timezone, dayStartMinute);
  const classification = input.classification ?? (await classify(deliverable, input.quantity));

  /* ── An unstated count is resolved by the UNIT, not by a default ────────
   * An empty Quantity box means the instructor did not say how many, and what
   * that means depends entirely on what the work was: one class IS one class,
   * so 1 is a fact; some unstated number of assignments is not, so it stays
   * null and prints "?".
   *
   * Resolved HERE and not in the form, because only here is the deliverable
   * known — the box is free text until something classifies it. Getting this
   * wrong renders "? Classes" against somebody who taught one class, which is
   * a question mark where there was never any doubt. */
  const quantity =
    input.quantity ??
    quantityWhenUnstated(
      deliverableFor(classification.deliverableCode, classification.activityTypeCode),
    );

  const fields = {
    instructorId: input.instructorId,
    universityId: input.universityId,
    activityTypeCode: classification.activityTypeCode,
    local: { date: input.date, start: hhmm(startMinute), end: hhmm(endMinute) },
    // Their words, kept exactly. The sheet shows this as the Deliverable.
    rawText: deliverable,
    /* The other two boxes, also kept exactly. Blank is normalised to null so
       "nobody typed anything" is one value rather than two that every reader
       would have to test for separately. */
    rawQuantity: input.rawQuantity?.trim() || null,
    rawWorkingHours: input.rawWorkingHours?.trim() || null,
    quantity,
    remarks: input.remarks ?? null,
    deliverableTypeId: classification.deliverableTypeId,
    broadCategoryId: classification.broadCategoryId,
  };

  return input.activityId
    ? updateActivity(input.activityId, { ...fields, excludeActivityId: input.activityId })
    : logActivity(fields);
}
