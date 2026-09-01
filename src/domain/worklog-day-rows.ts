/**
 * One row of the report, built from `WorklogEntry` — one row per day.
 *
 * ── This is the new model. `worklog-rows.ts` is the old one ───────────────
 * `buildPeriodRow` serves the manager's sheet, which still reads `ActivityLog`
 * and its taxonomy. This serves the instructor's page, which reads
 * `WorklogEntry`. Both exist on purpose and only for as long as that is true:
 * `buildPeriodRow` and the file it lives in are DELETED in the analytics
 * commit, once the manager's sheet moves here too.
 *
 * The duplication is the cheaper mistake. Changing the shared helper in place
 * would have broken two screens at once and made every failure ambiguous about
 * which model caused it.
 *
 * ── What is not here, and will not be ─────────────────────────────────────
 * The merge. `buildPeriodRow` calls `rollUp`, which folds a day's activities
 * together by deliverable name and sums their counts — it exists because the
 * old model had many rows per day and something had to combine them. A day IS
 * a row now. There is nothing to merge, no name to merge by, and no count to
 * sum. A day's text is printed as the instructor wrote it.
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

export type DayState = "recorded" | "missing" | "future";

/** Where a day's text came from. Mirrors `WorklogEntry.source`. */
export type DaySource = "NATIVE" | "MIGRATED";

/** One day, exactly as it is stored. Nothing here has been interpreted. */
export type DayEntry = {
  id: string;
  /** YYYY-MM-DD in the university's zone. */
  logDate: string;
  /** What they wrote. Printed verbatim; never parsed for display. */
  deliverable: string;
  /** The Quantity box, verbatim. Null means the box was left empty. */
  deliverableQuantity: string | null;
  /** The day's hours as a number, so the client formats once. */
  workingHours: number;
  remarks: string | null;
  source: DaySource;
};

export type DayRow = {
  /** Stable across re-renders and unique within a view. */
  key: string;
  label: string;
  sublabel?: string;
  /** Every date this row covers, ascending. One for a day, seven for a week. */
  dates: string[];
  /**
   * The days themselves, in date order.
   *
   * A Date Wise row holds one and a Week Wise row holds up to seven. Every
   * column prints from here — there is no interpreted alternative to fall back
   * to, and that is the point: what is on screen is what was typed.
   */
  days: DayEntry[];
  /** Sum of the days' hours, in minutes, for the one place a total is printed. */
  totalMinutes: number;
  /** Composed per the rule in `remarksFor`. */
  remarks: string;
  state: DayState;
  /**
   * True when any day in this row was reconstructed by the collapse.
   *
   * Per-row rather than per-day because it drives one quiet note under the
   * Deliverable cell, and a week showing seven of them would be noise.
   */
  hasMigrated: boolean;
};

/**
 * The Remarks column, composed from the two places a remark can live.
 *
 * ── The rule, and why it is this way round ────────────────────────────────
 * A day can carry a note the instructor wrote ABOUT THE DAY (`WorklogDayNote`)
 * and the day row carries its own `remarks`. They are not alternatives to be
 * concatenated: the day note is the more considered of the two, so where one
 * exists it is what the column says.
 *
 * A row spanning several days composes each separately and joins them with
 * semicolons in date order, skipping the empty ones, so a week's cell can still
 * be read back to the day it came from.
 */
export function remarksFor(
  dates: readonly string[],
  days: readonly DayEntry[],
  dayNotes: Readonly<Record<string, string>>,
): string {
  const byDate = new Map(days.map((d) => [d.logDate, d]));
  const parts: string[] = [];
  for (const date of [...dates].sort()) {
    const note = dayNotes[date]?.trim();
    if (note) {
      parts.push(note);
      continue;
    }
    const own = byDate.get(date)?.remarks?.trim();
    if (own) parts.push(own);
  }
  return parts.join("; ");
}

/**
 * One row, over one or more days.
 *
 * `buildPeriodRow`'s counterpart, and deliberately simpler: it filtered
 * activities to the row's dates and merged them, and this filters days to the
 * row's dates and keeps them.
 */
export function buildDayRow(input: {
  key: string;
  label: string;
  sublabel?: string;
  dates: readonly string[];
  days: readonly DayEntry[];
  dayNotes?: Readonly<Record<string, string>>;
  /** YYYY-MM-DD. A period entirely after this has not happened yet. */
  today: string;
}): DayRow {
  const dates = [...input.dates].sort();
  const mine = input.days
    .filter((d) => dates.includes(d.logDate))
    .sort((a, b) => a.logDate.localeCompare(b.logDate));

  const state: DayState =
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
    days: mine,
    /* Summed in minutes from the stored decimal, rounded once. Summing the
       formatted strings back would reintroduce the rounding this avoids. */
    totalMinutes: Math.round(mine.reduce((n, d) => n + d.workingHours, 0) * 60),
    remarks: remarksFor(dates, mine, input.dayNotes ?? {}),
    state,
    hasMigrated: mine.some((d) => d.source === "MIGRATED"),
  };
}
