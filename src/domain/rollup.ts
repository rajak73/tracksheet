/**
 * How a set of activities becomes one row of the report.
 *
 * ── One implementation, because two would drift ───────────────────────────
 * The instructor reads this sheet for their own days and a manager reads it
 * for their roster. If each page added the hours up its own way, the same week
 * would eventually show two totals and nobody could say which was right. The
 * rules below are the report's definition of itself.
 */

import { didHappen } from "@/domain/working-hours";
import { deliverableFor, quantityWhenUnstated } from "@/domain/worklog-taxonomy";

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
  /**
   * ISO instant this started. Optional, and only used for ORDER.
   *
   * The report reads in the order the day happened, which needs a position;
   * a week or month cell merges several days and has no single answer, so it
   * falls back to heaviest-first. See `ordered` in `worklog-report`.
   */
  startTime?: string;
  activityType: { code: string; label: string };
  /* The code decides what the client's report CALLS this line. Optional, so a
   * payload that predates the naming map still rolls up — it simply falls back
   * to the category's name. */
  deliverableType?: { code?: string } | null;
  broadCategory?: { label: string } | null;
  /** `null` is the client's `?` — the instructor never said how many. */
  quantity?: number | null;
};

export type RollupLine = {
  /** Unique per line. */
  key: string;
  /** The broad category — Lecture, Practice, Meeting — not the deliverable. */
  label: string;
  hours: number;
  /** `null` once any entry under this line is unknown. */
  quantity: number | null;
  /** Exact minutes, which is what the client's "1h 45m" is written from. */
  minutes: number;
  /**
   * Earliest start under this line, as an epoch millisecond.
   *
   * An ordinal for sorting, never a wall-clock reading — see where it is set.
   * Only ever compared against other values from the same period.
   */
  firstAt?: number;
};

export type Rollup = {
  lines: RollupLine[];
  /**
   * Every hour that happened. Preparation, meetings and admin included.
   *
   * This doc used to read "time spent WITH STUDENTS ... excluded", which is the
   * rule `countsAsWorkingHours` was changed away from — see the note there. It
   * is left explicit because a stale definition at the definition site is how
   * the old rule gets written back in.
   */
  hours: number;
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
 * ── Working Hours is everything that happened ─────────────────────────────
 * Classes and labs and mentoring, and equally preparation, meetings, reporting
 * and admin. The client defines an instructor's working time as what they wrote
 * down, so there is no judgement left about which of their hours count. It used
 * to be the student-facing subset — see `countsAsWorkingHours` for what changed
 * and why.
 *
 * The countable/uncountable split below therefore no longer divides the hours;
 * `countsAsWorkingHours` returns true for everything, so no line is muted in
 * practice and the Deliverable column does add up to Working Hours. The
 * machinery is kept because it is still what would express the old rule if the
 * client ever asks for it back, and because quantity still rides on it — a
 * count of deliverables is not a count of meetings.
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

    /* The CLIENT'S name for this work, not the taxonomy's.
     *
     * It used to be `a.activityType.label` — "Teaching", "Meetings", "Student
     * Query Resolution" — which is the schema's vocabulary appearing in the
     * client's report. Their list names the same work differently and to the
     * character: a lecture is a Live Class, a doubt session is Doubt Clearing.
     *
     * Mapping here rather than at each of the three screens this feeds is the
     * point: the instructor's sheet, the manager's sheet and the manager's CSV
     * all read this function, so one map keeps all three saying the same words
     * as the monthly tracker and the day summary. */
    const chosen = deliverableFor(a.deliverableType?.code, a.activityType.code);
    const label = chosen.name;
    /* Every recorded hour counts. The key used to carry a countability flag so
       one category could produce a counted and an uncounted line; there is only
       one kind of line now. */
    const key = label;
    const line = byCategory.get(key) ?? { key, label, hours: 0, minutes: 0, quantity: 0 as number | null };

    line.hours += a.durationHours;
    line.minutes += Math.round(a.durationHours * 60);
    if (a.startTime) {
      /* The INSTANT, not a wall clock.
       *
       * This was `getHours() * 60 + getMinutes()`, which reads the machine's own
       * timezone — the one thing nothing in this codebase is allowed to depend
       * on. A server in UTC and a laptop in IST would order the same day's
       * entries differently, and entries either side of local midnight would
       * order wrongly on both.
       *
       * `firstAt` exists only to sort, and it is only ever compared against
       * other `firstAt` values from the same period, so an ordinal is all it
       * has to be. An epoch millisecond is the same ordinal everywhere. */
      const at = new Date(a.startTime).getTime();
      line.firstAt = line.firstAt === undefined ? at : Math.min(line.firstAt, at);
    }
    /* `?? 1` used to sit here, and it is exactly the default the client's rule
     * forbids: an entry whose count nobody stated became one of them. What
     * happens now is decided by the UNIT — an occurrence is one of itself, an
     * item count stays unknown — and one unknown makes the line unknown, because
     * a partial sum reads like a complete one. */
    const stated = a.quantity === undefined ? quantityWhenUnstated(chosen) : a.quantity;
    line.quantity = line.quantity === null || stated === null ? null : line.quantity + stated;
    byCategory.set(key, line);
  }

  // Heaviest first: a cell is read top-down and the biggest commitment is the
  // one that should not need a second glance.
  const lines = [...byCategory.values()].sort((a, b) => b.hours - a.hours);

  return {
    lines,
    // Summed per line from per-activity hours, which is what keeps this
    // independent of how the period is grouped — see the defect described
    // above.
    hours: lines.reduce((n, l) => n + l.hours, 0),
    /* `subjects` used to be returned here — the distinct subject labels of the
     * entries in this period.
     *
     * It moved to the server, to `daySubjectsFor`, because of a rule this
     * function cannot honour: a day with no class of its own takes the subject
     * of the last office day that had one, and that day is usually outside the
     * period being rolled up. Derived from the entries in view, a month of
     * meetings answered "blank" while the sheet beside it showed the carried
     * subject.
     *
     * Removed rather than left in place: a caller reaching for the easy one
     * here would silently get the un-carried answer. */
    remarks: distinct(activities.map((a) => a.remarks)),
  };
}
