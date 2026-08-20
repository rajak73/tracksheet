/**
 * How a set of activities becomes one row of the report.
 *
 * ── One implementation, because two would drift ───────────────────────────
 * The instructor reads this sheet for their own days and a manager reads it
 * for their roster. If each page added the hours up its own way, the same week
 * would eventually show two totals and nobody could say which was right. The
 * rules below are the report's definition of itself.
 */

import { countsAsWorkingHours, didHappen } from "@/domain/working-hours";

/**
 * The least an entry has to be for this to add it up.
 *
 * Declared here rather than imported from the UI's `Activity`, which is what
 * this used to do. A rule that imports a component's type cannot be used by the
 * server without dragging React's half of the app behind it — and the point of
 * this layer is that both sides can call it.
 *
 * Structural, so the UI's `Activity` and a row selected straight out of Prisma
 * both satisfy it without either being changed or converted.
 */
export type RollupActivity = {
  durationHours: number;
  remarks: string | null;
  /**
   * Whether it happened. Optional because not every payload has always carried
   * it — an entry with no status is treated as having happened, which is what
   * `ActivityStatus`'s own default says.
   */
  status?: string;
  activityType: { code: string; label: string };
  deliverableType?: { isCountable: boolean } | null;
  broadCategory?: { label: string } | null;
  quantity?: number;
};

export type RollupLine = {
  /** Unique per line — a category can produce a counted and an uncounted one. */
  key: string;
  /** The broad category — Lecture, Practice, Meeting — not the deliverable. */
  label: string;
  hours: number;
  quantity: number;
  /** Whether this counts toward Working Hours and the quantity column. */
  countable: boolean;
};

export type Rollup = {
  lines: RollupLine[];
  /** Time spent WITH STUDENTS. Preparation, meetings and admin are excluded. */
  hours: number;
  subjects: string[];
  remarks: string[];
};

/** Distinct, in first-seen order. */
const distinct = (values: Array<string | null | undefined>) => [
  ...new Set(values.filter((v): v is string => Boolean(v && v.trim()))),
];

/**
 * ── Grouped by CATEGORY, not by the deliverable underneath it ─────────────
 * The client's sheet reads "Live Classes – 24h; Lesson Prep – 8h; Meetings /
 * Reports – 4h": about five lines a period, at the level of Lecture, Content
 * Development, Meeting. Grouping by the forty-four specific deliverables gives
 * finer detail than the report is written in.
 *
 * ── Countability comes from the DELIVERABLE, so it splits the line ────────
 * Because that is where the distinction lives: an Exam line counts its
 * evaluations and not its question-paper preparation. So countability is part
 * of what makes a line, not a flag stuck on one afterwards — Exam becomes two
 * lines when it holds both kinds, the counted one and the muted one.
 *
 * It was a flag, and that was a real defect: the hours of EVERY activity in a
 * category were added to one line, and a single countable deliverable anywhere
 * in it turned the whole line — preparation included — into Working Hours. The
 * damage grew with the grouping, because more activities fell into one line:
 * one instructor read 08h 00m a week when the sheet grouped by day, 13h 45m
 * when the same week was grouped as a week, and 18h 45m across a month, from
 * exactly the same entries. A total that changes with how you group it is not
 * a total. Summing per activity, as below, cannot do that.
 *
 * ── Working Hours is the time spent with students ─────────────────────────
 * Classes, labs, mentoring, doubt sessions, evaluations, workshops. Everything
 * else keeps its hours on its own line — it happened, and the sheet says so —
 * but it is not what that figure measures. Which means the Deliverable column
 * deliberately does NOT add up to Working Hours; the lines that do not count
 * are shown muted so nobody attempts the arithmetic.
 */
export function rollUp(activities: RollupActivity[]): Rollup {
  const byCategory = new Map<string, RollupLine>();

  for (const a of activities) {
    /* An absence is not work. The server-side readers — the tracker, the admin
     * network, hours-by-instructor — all exclude MISSED and EXCUSED, and this
     * did not, so the instructor's sheet and the manager's sheet counted a
     * lecture nobody gave while the tracker beside them did not. Same rule,
     * same list, one place. */
    if (!didHappen(a)) continue;

    const label = a.activityType.label;
    // A deliverable decides when there is one; otherwise the category does.
    // See `countsAsWorkingHours` — an entry with no deliverable used to be
    // read as "does not count", which silently dropped real teaching hours.
    const countable = countsAsWorkingHours(
      a.activityType.code,
      a.deliverableType ? a.deliverableType.isCountable : null,
    );
    const key = `${label}\u0000${countable}`;
    const line = byCategory.get(key) ?? { key, label, hours: 0, quantity: 0, countable };

    line.hours += a.durationHours;
    if (countable) line.quantity += a.quantity ?? 1;
    byCategory.set(key, line);
  }

  // Heaviest first: a cell is read top-down and the biggest commitment is the
  // one that should not need a second glance.
  const lines = [...byCategory.values()].sort((a, b) => b.hours - a.hours);

  return {
    lines,
    // Every hour inside a counted line is student-facing now, so this is the
    // same figure as adding up the countable activities one by one — which is
    // what makes it independent of the grouping.
    hours: lines.reduce((n, l) => n + (l.countable ? l.hours : 0), 0),
    /* What they actually taught, read from the entries themselves. Nothing is
     * inherited from a setting on the person, so this describes the period
     * rather than describing the instructor. A period whose lines name no
     * subject — a day of meetings — is left blank rather than borrowed. */
    subjects: distinct(activities.map((a) => a.broadCategory?.label)),
    remarks: distinct(activities.map((a) => a.remarks)),
  };
}
