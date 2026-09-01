/**
 * What a tracker cell says when it has nothing to show.
 *
 * ── Three empty states, and they are three different facts ────────────────
 * A grid cell has almost no room, and all three of these look like nothing —
 * which is exactly how they collapse into one. A manager scanning nineteen rows
 * acts differently on each:
 *
 *   FUTURE     the week has not happened. Nobody has failed at anything, and
 *              the cell is blank — no dash, no border treatment, nothing to
 *              read as a gap.
 *   MISSING    the week has passed and the instructor filed nothing. This is
 *              the one somebody follows up. An em dash: visibly empty.
 *   ZERO       they filed, and recorded no hours. "00h 00m", explicitly. It is
 *              a measurement they made, not an absence.
 *
 * The difference that matters most is the last two. "Filed nothing" and "filed
 * zero" are opposite facts about whether a person did their paperwork, and a
 * blank cell for both tells a manager to chase somebody who already answered.
 *
 * Kept as a function rather than as branching inside the grid so that both the
 * screen and the CSV decide it once, the same way — a screenshot and a
 * spreadsheet disagreeing about an empty cell is the failure this prevents.
 */

export type CellState = "future" | "missing" | "zero" | "recorded";

export function cellState(input: {
  /** The week's Monday, YYYY-MM-DD. */
  weekStart: string;
  /** Today in the UNIVERSITY's zone. A cell is future only against that. */
  today: string;
  /** How many days in this week carry a worklog row. */
  daysLogged: number;
  /** Minutes recorded across those days. */
  totalMinutes: number;
}): CellState {
  // Not yet reached only when the WHOLE week is still ahead: a week holding
  // today is in progress, and its passed days can genuinely be missing.
  if (input.weekStart > input.today) return "future";
  if (input.daysLogged === 0) return "missing";
  return input.totalMinutes === 0 ? "zero" : "recorded";
}

/** What the cell prints. One place, so the grid and the CSV cannot diverge. */
export function cellText(state: CellState, formatted: string): string {
  if (state === "future") return "";
  if (state === "missing") return "—";
  // `zero` falls through: the formatter renders 0 as "00h 00m", which is the
  // point — see `workingHours`.
  return formatted;
}
