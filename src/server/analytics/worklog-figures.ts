import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";

/**
 * The figures that survive without a shared vocabulary.
 *
 * ── Why these three, and only these ───────────────────────────────────────
 * The taxonomy did one thing well that free text cannot: it forced every
 * instructor into a shared set of names, which is what made "hours by kind of
 * work, across the roster" possible. One person writes "Java class", the next
 * "lecture", the next "LC - 2nd yr". Those do not align across people, and any
 * figure that adds them up is stating an agreement that does not exist.
 *
 * So the cross-instructor figures are the ones that need no agreement at all —
 * they count days and add up hours, and both mean the same thing in every
 * instructor's own words:
 *
 *   total hours    every recorded hour in the period
 *   days logged    how many instructor-days carry a worklog
 *   coverage       how many of the days that COULD carry one actually do
 *
 * Coverage is the one worth having and the one that was missing. "412 hours"
 * says nothing about whether anybody failed to file; "38 of 45 instructor-days
 * logged" says exactly that, and it is the question a manager opens the page
 * with.
 *
 * ── Read from WorklogEntry, with no model anywhere ────────────────────────
 * Counted straight from the rows. Nothing here calls a model, so nothing here
 * can be unavailable because a generation has not run — which is what lets a
 * page always show something true while the extraction-derived panels beside
 * it say they are not ready.
 */

export type WorklogFigures = {
  /** Every recorded hour in the period, to two decimals. */
  totalHours: number;
  /** Instructor-days carrying a worklog. One per instructor per date. */
  daysLogged: number;
  /** How many distinct instructors filed anything at all. */
  instructorsLogging: number;
};

/**
 * Totals over a period, for whichever instructors are named.
 *
 * An empty list returns zeroes rather than "every instructor": a caller that
 * has narrowed to nobody means nobody, and answering with the whole tenant
 * would be the widest possible failure of a scope filter.
 */
export async function worklogFigures(
  instructorIds: string[],
  from: string,
  to: string,
): Promise<WorklogFigures> {
  if (instructorIds.length === 0) {
    return { totalHours: 0, daysLogged: 0, instructorsLogging: 0 };
  }

  const rows = await prisma.worklogEntry.findMany({
    where: {
      instructorId: { in: instructorIds },
      logDate: { gte: toDateOnly(from), lte: toDateOnly(to) },
    },
    select: { instructorId: true, workingHours: true },
  });

  const minutes = rows.reduce((n, r) => n + Math.round(Number(r.workingHours) * 60), 0);
  return {
    /* Summed in minutes and divided once. Adding decimal hours row by row
       accumulates the rounding, and this figure is reconciled by hand against a
       spreadsheet. */
    totalHours: Math.round((minutes / 60) * 100) / 100,
    // One row IS one instructor-day: `(instructorId, logDate)` is unique.
    daysLogged: rows.length,
    instructorsLogging: new Set(rows.map((r) => r.instructorId)).size,
  };
}
