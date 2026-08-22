import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { logActivity, updateActivity } from "@/server/activities/logger";
import { loadTaxonomy } from "@/server/worklog/taxonomy";
import { parseBullets } from "@/server/worklog/parse";
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
 * Reads the deliverable line and answers with the columns the form does not ask
 * for.
 *
 * Never throws. A provider outage must not stop somebody recording their day —
 * the entry is saved with `OTHER` and no subject, and the day inherits its
 * Broad Category from the last one that had a subject, which is the same answer
 * a line naming no subject would have produced anyway.
 */
async function classify(deliverable: string, quantity: number | null): Promise<Classification> {
  const fallback: Classification = {
    activityTypeCode: "OTHER",
    deliverableTypeId: null,
    deliverableCode: null,
    broadCategoryId: null,
  };

  try {
    const taxonomy = await loadTaxonomy();
    // Phrased as one worklog line so the existing instruction applies unchanged.
    // Phrased as one worklog line so the existing instruction applies unchanged.
    // A count nobody stated adds nothing to the sentence.
    const line = quantity !== null && quantity > 1 ? `${deliverable} (${quantity})` : deliverable;
    const parsed = await parseBullets([line], taxonomy);
    if (!parsed.ok || parsed.bullets.length === 0) return fallback;

    const bullet = parsed.bullets[0]!;
    const deliverableType = bullet.deliverableCode
      ? taxonomy.deliverableByCode.get(bullet.deliverableCode)
      : undefined;
    const subject = bullet.subjectCode
      ? taxonomy.subjectByCode.get(bullet.subjectCode)
      : undefined;

    return {
      // The parser answers from the closed list, but a code it invented would
      // fail the write — so an unknown one falls back rather than throwing.
      activityTypeCode: taxonomy.categoryByCode.has(bullet.categoryCode)
        ? bullet.categoryCode
        : fallback.activityTypeCode,
      deliverableTypeId: deliverableType?.id ?? null,
      deliverableCode: deliverableType?.code ?? null,
      broadCategoryId: subject?.id ?? null,
    };
  } catch {
    return fallback;
  }
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
    const parsed = await parseBullets(
      lines.map((l) =>
        l.quantity !== null && l.quantity > 1 ? `${l.deliverable} (${l.quantity})` : l.deliverable,
      ),
      taxonomy,
    );
    if (!parsed.ok) return lines.map(() => fallback);

    return lines.map((_, i) => {
      const bullet = parsed.bullets[i];
      if (!bullet) return fallback;
      const deliverableType = bullet.deliverableCode
        ? taxonomy.deliverableByCode.get(bullet.deliverableCode)
        : undefined;
      const subject = bullet.subjectCode ? taxonomy.subjectByCode.get(bullet.subjectCode) : undefined;
      return {
        activityTypeCode: taxonomy.categoryByCode.has(bullet.categoryCode)
          ? bullet.categoryCode
          : fallback.activityTypeCode,
        deliverableTypeId: deliverableType?.id ?? null,
        deliverableCode: deliverableType?.code ?? null,
        broadCategoryId: subject?.id ?? null,
      };
    });
  } catch {
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
    quantity,
    remarks: input.remarks ?? null,
    deliverableTypeId: classification.deliverableTypeId,
    broadCategoryId: classification.broadCategoryId,
  };

  return input.activityId
    ? updateActivity(input.activityId, { ...fields, excludeActivityId: input.activityId })
    : logActivity(fields);
}
