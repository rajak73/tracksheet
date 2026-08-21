import { prisma } from "@/server/db";
import { DID_NOT_HAPPEN } from "@/domain/working-hours";

/**
 * Which stream an instructor teaches, decided from their own work.
 *
 * ── Why this is not a field somebody fills in ─────────────────────────────
 * It was: `Instructor.categoryId`, set by an admin through a picker. The client
 * does not want a person's stream to be somebody's opinion — it should follow
 * what they actually taught. In practice the field was never used either; every
 * instructor in the database had it unset.
 *
 * ── Counting, not a second opinion ────────────────────────────────────────
 * The AI already makes the hard judgement, once per entry: reading "took a DBMS
 * lecture on normalisation", it records that line as TECH. Turning many of those
 * into one stream per person is arithmetic, and arithmetic is the right tool
 * here for three reasons. It can be shown to the client as hours. It cannot
 * hallucinate a subject nobody taught. And it is testable, which a second model
 * call asking "what stream is this person?" would not be.
 *
 * So this reads the decisions the parser already made and adds them up.
 *
 * ── Hours, not entries ────────────────────────────────────────────────────
 * A three-hour lecture says more about what somebody teaches than a ten-minute
 * doubt session, and counting rows would rank them equally. Duration is not a
 * stored column — deliberately, see the note on ActivityLog — so it is summed
 * from the two instants in SQL rather than fetched and added up in Node.
 *
 * ── When it says nothing ──────────────────────────────────────────────────
 * `null`, rendered as "Not yet determined". Two honest cases: somebody new who
 * has not recorded work yet, and somebody whose sentences never name a subject
 * — the parser is instructed to return null rather than guess, and it does that
 * often. Nothing is inherited from their manager and nothing falls back to a
 * default, because a borrowed stream is indistinguishable on screen from a
 * measured one.
 */

/**
 * How far back the evidence is read.
 *
 * Long enough that a light month does not blank somebody out, short enough that
 * an instructor who moved from Aptitude to Technical stops being described by
 * work they no longer do. All-time would be more stable and would keep
 * describing people by what they taught a year ago.
 */
export const STREAM_WINDOW_DAYS = 90;

export type InstructorStream = { code: string; label: string } | null;

type Row = {
  instructorId: string;
  code: string;
  label: string;
  hours: number;
  sortOrder: number;
};

/**
 * The dominant stream for each of these instructors.
 *
 * One query for the whole set rather than one per instructor: the directory
 * lists everybody at once, and this sits in that response.
 *
 * Instructors with no subject-carrying work are absent from the returned map;
 * callers should read a missing key as "not yet determined" rather than as an
 * error.
 */
export async function streamsFor(
  instructorIds: string[],
  now: Date = new Date(),
): Promise<Map<string, InstructorStream>> {
  const out = new Map<string, InstructorStream>();
  if (instructorIds.length === 0) return out;

  const since = new Date(now.getTime() - STREAM_WINDOW_DAYS * 86_400_000);
  const notHappened = [...DID_NOT_HAPPEN];

  /* Grouped in SQL. The alternative is fetching every entry for every
   * instructor and adding them up here, which is how the admin dashboard once
   * came to hold 1.3 million rows in memory. */
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT a."instructorId"                                                     AS "instructorId",
           c.code                                                               AS "code",
           c.label                                                              AS "label",
           SUM(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")) / 3600.0)::float8 AS "hours",
           MIN(c."sortOrder")::int                                              AS "sortOrder"
    FROM "ActivityLog" a
    JOIN "InstructorCategory" c ON c.id = a."broadCategoryId"
    WHERE a."instructorId" = ANY(${instructorIds}::text[])
      AND a."workDate" >= ${since}
      AND a.status::text <> ALL(${notHappened}::text[])
    GROUP BY 1, 2, 3
  `;

  /* Most hours wins. A tie is broken by the taxonomy's own order and then by
   * code, so the same evidence always produces the same answer — a stream that
   * flipped between two equal subjects on each page load would look like a bug
   * and would be one. */
  const best = new Map<string, Row>();
  for (const row of rows) {
    const current = best.get(row.instructorId);
    if (
      !current ||
      row.hours > current.hours ||
      (row.hours === current.hours &&
        (row.sortOrder < current.sortOrder ||
          (row.sortOrder === current.sortOrder && row.code < current.code)))
    ) {
      best.set(row.instructorId, row);
    }
  }

  for (const [instructorId, row] of best) {
    out.set(instructorId, { code: row.code, label: row.label });
  }
  return out;
}

/** The same answer for one instructor. */
export async function streamFor(instructorId: string, now?: Date): Promise<InstructorStream> {
  return (await streamsFor([instructorId], now)).get(instructorId) ?? null;
}
