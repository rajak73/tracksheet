/**
 * One row of the client's report, for any period, for either role.
 *
 * ── Why this exists once ──────────────────────────────────────────────────
 * The instructor's screen and the manager's read the same rows and print the
 * same eight columns; only the SCOPE and the GROUPING differ. That was two
 * implementations of the merge, which is two chances to disagree about
 * something the client reconciles by hand — and they already had: one merged
 * day summaries by name, the other merged activities by category, and a Tech
 * "Live Class" and a Maths one combined on one screen and not the other.
 *
 * So the merge lives here and both roles call it. What each role supplies is
 * which activities and which dates; what comes back is a row.
 *
 * ── Three states a period can be in, and they are not the same ────────────
 *   recorded   somebody wrote something down.
 *   missing    the day has passed and nobody did. A manager acts on this.
 *   future     the day has not happened yet. Nobody has failed at anything.
 *
 * Collapsing `missing` and `future` into one empty-looking row is the failure
 * this distinction exists to prevent: half a week ahead of "today" would read
 * as half a week of people not filing.
 */

import { rollUp, type RollupActivity } from "@/domain/rollup";
import type { ReportLine } from "@/domain/worklog-report";

export type PeriodState = "recorded" | "missing" | "future";

/** An activity, plus which day it belongs to. */
export type RowActivity = RollupActivity & {
  /** YYYY-MM-DD in the university's zone. */
  workDate: string;
};

export type PeriodRow = {
  /** Stable across re-renders and unique within a view. */
  key: string;
  label: string;
  sublabel?: string;
  /** Every date this row covers, ascending. One for a day, seven for a week. */
  dates: string[];
  /** Merged deliverables, ready for `deliverableCell` / `quantityCell`. */
  lines: ReportLine[];
  totalMinutes: number;
  /** Distinct subjects the period touched, in the order first seen. */
  subjects: string[];
  /** Composed per the rule in `remarksFor`. */
  remarks: string;
  state: PeriodState;
};

/**
 * The Remarks column, composed from the two places a remark can live.
 *
 * ── The rule, and why it is this way round ────────────────────────────────
 * A day can carry a note the instructor wrote ABOUT THE DAY (`WorklogDayNote`),
 * and each entry can carry its own remark (`ActivityLog.remarks`). They are not
 * alternatives to be concatenated: the day note is the instructor speaking
 * about the whole day and is the more considered of the two, so where one
 * exists it is what the column says. Where none does, the entries' own remarks
 * stand in, de-duplicated — four lectures on one topic would otherwise print
 * the same sentence four times.
 *
 * A period spanning several days composes each day separately and joins them
 * with semicolons in date order, skipping the empty ones, so a week's cell can
 * still be read back to the day it came from.
 */
export function remarksFor(
  dates: readonly string[],
  activities: readonly RowActivity[],
  dayNotes: Readonly<Record<string, string>>,
): string {
  const parts: string[] = [];
  for (const date of [...dates].sort()) {
    const note = dayNotes[date]?.trim();
    if (note) {
      parts.push(note);
      continue;
    }
    const seen = new Set<string>();
    const fromEntries: string[] = [];
    for (const activity of activities) {
      if (activity.workDate !== date) continue;
      const remark = activity.remarks?.trim();
      if (!remark || seen.has(remark.toLowerCase())) continue;
      seen.add(remark.toLowerCase());
      fromEntries.push(remark);
    }
    if (fromEntries.length > 0) parts.push(fromEntries.join(", "));
  }
  return parts.join("; ");
}

/** Distinct subjects the period touched, first seen first. */
export function subjectsIn(activities: readonly RowActivity[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const activity of activities) {
    const label = activity.broadCategory?.label?.trim();
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    kept.push(label);
  }
  return kept;
}

/**
 * One period's row.
 *
 * The merge is `rollUp`'s — the same function the manager's sheet has always
 * used — so a Tech "Live Class" and a Maths one become one line with their
 * hours added, on every screen, because there is only one place that decides.
 */
export function buildPeriodRow(input: {
  key: string;
  label: string;
  sublabel?: string;
  dates: readonly string[];
  activities: readonly RowActivity[];
  dayNotes?: Readonly<Record<string, string>>;
  /** YYYY-MM-DD. A period entirely after this has not happened yet. */
  today: string;
}): PeriodRow {
  const dates = [...input.dates].sort();
  const mine = input.activities.filter((a) => dates.includes(a.workDate));
  const { lines, hours } = rollUp(mine);

  const state: PeriodState =
    mine.length > 0
      ? "recorded"
      : // Not yet reached only when the WHOLE period is still ahead: a week
        // holding today is in progress, and its passed days can be missing.
        dates[0]! > input.today
        ? "future"
        : "missing";

  return {
    key: input.key,
    label: input.label,
    sublabel: input.sublabel,
    dates,
    lines: lines.map((l) => ({
      name: l.label,
      minutes: l.minutes,
      quantity: l.quantity,
      firstAt: l.firstAt,
    })),
    totalMinutes: Math.round(hours * 60),
    subjects: subjectsIn(mine),
    remarks: remarksFor(dates, mine, input.dayNotes ?? {}),
    state,
  };
}

/* ── The periods themselves ────────────────────────────────────────────────
 * Pure date arithmetic on YYYY-MM-DD strings, deliberately: a Date object
 * carries a timezone and every one of these is a calendar question, not an
 * instant. */

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
