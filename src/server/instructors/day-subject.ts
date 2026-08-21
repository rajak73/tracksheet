import { prisma } from "@/server/db";
import { DID_NOT_HAPPEN } from "@/domain/working-hours";
import { resolveWorkingDay, type UniversityTimeConfig } from "@/server/time/schedule-windows";

/**
 * What subject an instructor's day was about.
 *
 * ── The rule, as the client stated it ─────────────────────────────────────
 * The subject comes from the class they took: a lecture on data structures is
 * Technical, one on grammar is English. The parser already decides that per
 * line and stores it on the entry.
 *
 * But a day is often not a teaching day. Meetings, reporting, preparation — the
 * parser correctly returns null for those, because the sentence names no
 * subject and guessing at one would corrupt the column the whole report is
 * grouped by. That left most days blank.
 *
 * So a day with no subject of its own inherits from the last office day that
 * had one. An instructor who taught Physics on Friday and spent Monday in
 * meetings is still a Physics instructor on Monday.
 *
 * ── Derived on read, never written to the entry ───────────────────────────
 * `ActivityLog.broadCategoryId` keeps saying exactly what the sentence said —
 * null when nothing was named. The inheritance happens here, on the way to the
 * screen, so the stored data stays a record of what was written rather than a
 * record of what was inferred. That distinction is what lets this rule be
 * changed later without a migration, and what stops an inference being
 * mistaken for evidence by the next reader.
 */

/**
 * How far back a day may inherit from.
 *
 * Ten office days — about a fortnight. Long enough to cover a stretch of
 * meetings, a conference, a week of marking. Past that the label would be
 * describing work old enough that it may no longer be what they teach, so the
 * day goes blank instead and says so.
 */
export const CARRY_FORWARD_OFFICE_DAYS = 10;

/** Bounds the history query. Ten office days can never span more than this. */
const MAX_LOOKBACK_CALENDAR_DAYS = 40;

export type DaySubject = {
  code: string;
  label: string;
  /**
   * The day this was inherited FROM, or null when the day named its own
   * subject. Callers can use it to mark a carried label as carried.
   */
  carriedFrom: string | null;
} | null;

type Row = {
  instructorId: string;
  workDate: Date;
  code: string;
  label: string;
  hours: number;
  sortOrder: number;
};

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const datesBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/**
 * The subject of each office day in `[from, to]`, for each instructor.
 *
 * Non-office days — weekends, holidays — are absent from the returned map:
 * they are not days anybody is expected to teach on, so they carry no subject
 * and are not counted against the inheritance limit either.
 */
export async function daySubjectsFor(
  instructorIds: string[],
  from: string,
  to: string,
  config: UniversityTimeConfig,
): Promise<Map<string, Map<string, DaySubject>>> {
  const out = new Map<string, Map<string, DaySubject>>();
  if (instructorIds.length === 0) return out;

  /* Read further back than asked, so the first day of the window can inherit
   * from before it. Bounded, or a January request would scan the year. */
  const lookbackFrom = addDays(from, -MAX_LOOKBACK_CALENDAR_DAYS);
  const notHappened = [...DID_NOT_HAPPEN];

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT a."instructorId"                                                     AS "instructorId",
           a."workDate"                                                         AS "workDate",
           c.code                                                               AS "code",
           c.label                                                              AS "label",
           SUM(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")) / 3600.0)::float8 AS "hours",
           MIN(c."sortOrder")::int                                              AS "sortOrder"
    FROM "ActivityLog" a
    JOIN "InstructorCategory" c ON c.id = a."broadCategoryId"
    WHERE a."instructorId" = ANY(${instructorIds}::text[])
      AND a."workDate" BETWEEN ${new Date(`${lookbackFrom}T00:00:00.000Z`)}
                           AND ${new Date(`${to}T00:00:00.000Z`)}
      AND a.status::text <> ALL(${notHappened}::text[])
    GROUP BY 1, 2, 3, 4
  `;

  /* instructorId -> date -> the subject they actually taught most that day.
   * Ties break on the taxonomy's order then the code, so the same evidence
   * always gives the same answer. */
  const taught = new Map<string, Map<string, Row>>();
  for (const row of rows) {
    const date = row.workDate.toISOString().slice(0, 10);
    let perDate = taught.get(row.instructorId);
    if (!perDate) taught.set(row.instructorId, (perDate = new Map()));
    const current = perDate.get(date);
    if (
      !current ||
      row.hours > current.hours ||
      (row.hours === current.hours &&
        (row.sortOrder < current.sortOrder ||
          (row.sortOrder === current.sortOrder && row.code < current.code)))
    ) {
      perDate.set(date, row);
    }
  }

  // Office days only, in order, including the lookback so inheritance can start
  // before the window the caller asked about.
  const officeDays = datesBetween(lookbackFrom, to).filter(
    (d) => resolveWorkingDay(config, d).isWorkingDay,
  );

  for (const instructorId of instructorIds) {
    const perDate = taught.get(instructorId) ?? new Map<string, Row>();
    const answer = new Map<string, DaySubject>();

    let last: { row: Row; date: string } | null = null;
    let officeDaysSinceLast = 0;

    for (const date of officeDays) {
      const own = perDate.get(date);
      if (own) {
        last = { row: own, date };
        officeDaysSinceLast = 0;
      } else if (last) {
        officeDaysSinceLast += 1;
      }

      // Only the requested window is reported; the rest was read to build `last`.
      if (date < from) continue;

      if (own) {
        answer.set(date, { code: own.code, label: own.label, carriedFrom: null });
      } else if (last && officeDaysSinceLast <= CARRY_FORWARD_OFFICE_DAYS) {
        answer.set(date, { code: last.row.code, label: last.row.label, carriedFrom: last.date });
      } else {
        // Nothing to inherit, or the last teaching day is too old to still
        // describe them. "Not yet determined" on screen.
        answer.set(date, null);
      }
    }

    out.set(instructorId, answer);
  }

  return out;
}
