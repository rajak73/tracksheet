/**
 * The periods a report is cut into.
 *
 * ── Why these live on their own ───────────────────────────────────────────
 * They were inside `worklog-rows.ts`, beside the old taxonomy-merging row
 * builder — so every screen that only wanted "which dates are in this week"
 * imported the merge as well, and the merge cannot be deleted while anything
 * imports the file for these.
 *
 * They are pure date arithmetic over `YYYY-MM-DD` strings and always were:
 * nothing here knows what an activity is, let alone what kind. Separating them
 * is what lets the old builder go without taking a calendar with it.
 *
 * Strings rather than `Date` objects, deliberately: a `Date` carries a timezone
 * and every question here is a calendar question. "Which Monday does this week
 * start on" has one answer in Kolkata and another in New York only if you let
 * an instant into it.
 */

export const addDays = (date: string, days: number): string => {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

/** The Monday of that date's week. */
export function mondayOf(date: string): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  // getUTCDay is 0 for Sunday, which belongs to the week that started six days
  // earlier rather than to the one about to start.
  const offset = (at.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}

/** Every date of the week containing `date`, Monday first. */
export function weekOf(date: string, days = 7): string[] {
  const monday = mondayOf(date);
  return Array.from({ length: days }, (_, i) => addDays(monday, i));
}

/** The weeks a month spans, each as its days clipped to that month. */
export function weeksOfMonth(month: string): Array<{ index: number; dates: string[] }> {
  const first = `${month}-01`;
  const at = new Date(`${first}T00:00:00.000Z`);
  at.setUTCMonth(at.getUTCMonth() + 1);
  const nextMonth = at.toISOString().slice(0, 10);

  const weeks: Array<{ index: number; dates: string[] }> = [];
  let cursor = mondayOf(first);
  while (cursor < nextMonth) {
    // Clipped, so week one is not four days of the previous month and week
    // five is not three days of the next.
    const dates = weekOf(cursor).filter((d) => d >= first && d < nextMonth);
    if (dates.length > 0) weeks.push({ index: weeks.length + 1, dates });
    cursor = addDays(cursor, 7);
  }
  return weeks;
}
