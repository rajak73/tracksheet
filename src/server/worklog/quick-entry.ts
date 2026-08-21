import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { logActivity, updateActivity } from "@/server/activities/logger";
import { loadTaxonomy } from "@/server/worklog/taxonomy";
import { parseBullets } from "@/server/worklog/parse";
import { loadUniversityConfig } from "@/server/universities/config";
import { dayOfWeekFor } from "@/server/time/schedule-windows";
import { toDateOnly, zonedParts } from "@/server/time/workday";

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
  quantity: number;
  workingHours: number;
  remarks?: string | null;
  /**
   * Set when EDITING an existing row. The overlap check ignores it — an entry
   * must never be reported as conflicting with itself — and the row is updated
   * in place rather than replaced, so its id, its audit trail and anything
   * pointing at it survive the edit.
   */
  activityId?: string;
};

/** What the model made of the deliverable line. Every field may be absent. */
type Classification = {
  activityTypeCode: string;
  deliverableTypeId: string | null;
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
async function classify(deliverable: string, quantity: number): Promise<Classification> {
  const fallback: Classification = {
    activityTypeCode: "OTHER",
    deliverableTypeId: null,
    broadCategoryId: null,
  };

  try {
    const taxonomy = await loadTaxonomy();
    // Phrased as one worklog line so the existing instruction applies unchanged.
    const line = quantity > 1 ? `${deliverable} (${quantity})` : deliverable;
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
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new ApiError(400, "QUANTITY_INVALID", "Quantity must be a whole number.");
  }

  const config = await loadUniversityConfig(input.universityId);
  const weekday = dayOfWeekFor(input.date, config.timezone);
  const hours = config.workingHours.find((h) => h.dayOfWeek === weekday);
  // A day the university does not work is still a day somebody may have worked,
  // so this places the entry rather than refusing it. 09:00 is the stand-in.
  const dayStartMinute = hours?.startMinute ?? 9 * 60;

  const { startMinute, endMinute } = await placeOnDay(input, config.timezone, dayStartMinute);
  const classification = await classify(deliverable, input.quantity);

  const fields = {
    instructorId: input.instructorId,
    universityId: input.universityId,
    activityTypeCode: classification.activityTypeCode,
    local: { date: input.date, start: hhmm(startMinute), end: hhmm(endMinute) },
    // Their words, kept exactly. The sheet shows this as the Deliverable.
    rawText: deliverable,
    quantity: input.quantity,
    remarks: input.remarks ?? null,
    deliverableTypeId: classification.deliverableTypeId,
    broadCategoryId: classification.broadCategoryId,
  };

  return input.activityId
    ? updateActivity(input.activityId, { ...fields, excludeActivityId: input.activityId })
    : logActivity(fields);
}
