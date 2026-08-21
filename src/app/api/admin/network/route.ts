import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { toDateOnly } from "@/server/time/workday";
import { countsAsWorkingHours, DID_NOT_HAPPEN } from "@/domain/working-hours";

/**
 * The network, one row per university, for the admin dashboard.
 *
 * ── Why this is not `/api/admin/overview` ─────────────────────────────────
 * That route reads the pre-aggregated metrics table, which stores MINUTES —
 * capacity, productive, unutilized. Those are the engine's every-recorded-
 * minute figures, and Working Hours is not one of them: it counts only time
 * spent with students, and that answer lives on each entry's deliverable (or,
 * when an entry carries none, on its category). Neither fact survives into the
 * daily metric rows, so a student-facing total cannot be recovered from them.
 * This reads the entries.
 *
 * ── Rolled up on the server, deliberately ─────────────────────────────────
 * `rollUp` does this in the browser for one instructor's sheet, where the
 * activities are on screen anyway. A network of thirty universities is a
 * different amount of data, and shipping every entry so the browser can add
 * them up would make the payload grow with the institute. The RULE is shared —
 * `countsAsWorkingHours`, the same function the sheets use — even though the
 * arithmetic happens here.
 *
 * ── Missing is not zero ───────────────────────────────────────────────────
 * An instructor who recorded nothing and an instructor who recorded a day of
 * meetings both show 00h 00m of Working Hours, and they are not the same
 * situation: one is a data problem, the other is a workload problem. So
 * `recording` counts the people who wrote something at all, and the difference
 * is reported as its own number rather than folded into an average.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* Shape is not a calendar.
 *
 * `2026-02-31` matches DAY, and the span check below is computed with
 * `Date.parse`, which gives NaN for it — and every comparison against NaN is
 * false, so `spanDays > MAX_RANGE_DAYS` was skipped and the cap did not apply.
 * `toDateOnly` then rolled the date over into March, so the query answered a
 * different question than the one asked. */
const isRealDate = (iso: string): boolean => {
  const [y, m, d] = iso.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
};

/** A month across the whole network is the widest this is meant to serve. */
const MAX_RANGE_DAYS = 62;

const round = (n: number) => Math.round(n * 100) / 100;

/** `code` rides along for the colour; `categoryColor` keys on the code, and
 *  passing it a label silently returns the fallback grey for everything. */
type Line = { code: string; label: string; hours: number; countable: boolean };

export const GET = withAuth(
  async ({ req }) => {
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const to = req.nextUrl.searchParams.get("to") ?? "";

    if (!DAY.test(from) || !DAY.test(to) || from > to || !isRealDate(from) || !isRealDate(to)) {
      return NextResponse.json(
        { error: { code: "BAD_RANGE", message: "Give a from and to date, as YYYY-MM-DD." } },
        { status: 400 },
      );
    }

    const spanDays =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (spanDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        {
          error: {
            code: "RANGE_TOO_WIDE",
            message: `Ask for at most ${MAX_RANGE_DAYS} days at a time.`,
          },
        },
        { status: 400 },
      );
    }

    /* ── The database does the arithmetic ───────────────────────────────
     * This used to select every ActivityLog row in the range and add them up in
     * Node. Measured against a 3.9-million-row database at the scale the client
     * actually operates — 100 universities of 100 instructors — a single month
     * view fetched 1,320,000 rows in 30.9 seconds and left a 1.7 GB heap. The
     * container has 512 MB, so that is not a slow page: it is the process being
     * killed.
     *
     * Grouping in SQL returns about 600 rows for the same question, because
     * there are only so many (university × category × countability) pairs no
     * matter how many entries fall into them.
     *
     * The RULE does not move. `countsAsWorkingHours` still decides what counts,
     * applied below to the grouped rows — the database sums hours per group and
     * has no opinion about which groups are Working Hours. That distinction is
     * why this is an optimisation and not a second definition.
     *
     * Raw SQL rather than `groupBy` because the figure being summed is
     * `endTime - startTime`, and duration is deliberately not a stored column —
     * see the note on ActivityLog. Prisma cannot group on an expression.
     */
    type Grouped = {
      universityId: string;
      typeCode: string;
      typeLabel: string;
      countable: boolean | null;
      hours: number;
      lastDate: Date;
    };
    type Recorders = { universityId: string; recording: bigint };

    const notHappened = [...DID_NOT_HAPPEN];

    const [universities, instructorCounts, grouped, recorders] = await Promise.all([
      prisma.university.findMany({
        // Soft-deleted universities are gone, not silent — showing them as
        // "nobody recorded anything" would invent a compliance problem.
        where: { deletedAt: null, status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, slug: true },
      }),
      prisma.instructor.groupBy({
        by: ["universityId"],
        where: { user: { isActive: true } },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Grouped[]>`
        SELECT a."universityId"                                              AS "universityId",
               t.code                                                        AS "typeCode",
               t.label                                                       AS "typeLabel",
               d."isCountable"                                               AS "countable",
               SUM(EXTRACT(EPOCH FROM (a."endTime" - a."startTime")) / 3600.0)::float8 AS "hours",
               MAX(a."workDate")                                             AS "lastDate"
        FROM "ActivityLog" a
        JOIN "ActivityType" t ON t.id = a."activityTypeId"
        LEFT JOIN "DeliverableType" d ON d.id = a."deliverableTypeId"
        WHERE a."workDate" BETWEEN ${toDateOnly(from)}::date AND ${toDateOnly(to)}::date
          AND a.status::text <> ALL(${notHappened}::text[])
        GROUP BY 1, 2, 3, 4
      `,
      /* Distinct people, separately: it cannot be derived from the groups above
       * without double-counting anybody who recorded two kinds of work.
       *
       * Counted over the SAME population as the head count above, which takes
       * only active instructors. This did not, so a departed instructor's logs
       * were counted as somebody recording — and `silent`, which is the
       * difference between the two, cancelled a departed person's old entries
       * against an active person's silence. The one number on this dashboard
       * whose whole job is to say "nobody has written anything" was quietly
       * under-reporting. */
      prisma.$queryRaw<Recorders[]>`
        SELECT a."universityId" AS "universityId",
               COUNT(DISTINCT a."instructorId") AS "recording"
        FROM "ActivityLog" a
        JOIN "Instructor" i ON i.id = a."instructorId"
        JOIN "User" u ON u.id = i."userId"
        WHERE a."workDate" BETWEEN ${toDateOnly(from)}::date AND ${toDateOnly(to)}::date
          AND a.status::text <> ALL(${notHappened}::text[])
          AND u."isActive" = true
        GROUP BY 1
      `,
    ]);

    const headCount = new Map(instructorCounts.map((r) => [r.universityId, r._count._all]));
    const recordingCount = new Map(recorders.map((r) => [r.universityId, Number(r.recording)]));

    type Bucket = {
      workingHours: number;
      otherHours: number;
      lines: Map<string, Line>;
      lastDate: string | null;
    };
    const buckets = new Map<string, Bucket>();

    for (const row of grouped) {
      let bucket = buckets.get(row.universityId);
      if (!bucket) {
        bucket = { workingHours: 0, otherHours: 0, lines: new Map(), lastDate: null };
        buckets.set(row.universityId, bucket);
      }

      // The one place the rule is applied — on ~600 rows rather than 1.3M.
      const countable = countsAsWorkingHours(row.typeCode, row.countable);

      if (countable) bucket.workingHours += row.hours;
      else bucket.otherHours += row.hours;

      // Split by countability as well as by category, for the same reason the
      // sheets do: one category can hold both kinds, and merging them makes a
      // line whose hours do not match what it contributes.
      const key = `${row.typeCode} ${countable}`;
      const line = bucket.lines.get(key) ?? {
        code: row.typeCode,
        label: row.typeLabel,
        hours: 0,
        countable,
      };
      line.hours += row.hours;
      bucket.lines.set(key, line);

      const day = row.lastDate.toISOString().slice(0, 10);
      if (!bucket.lastDate || day > bucket.lastDate) bucket.lastDate = day;
    }

    const rows = universities.map((u) => {
      const bucket = buckets.get(u.id);
      const instructors = headCount.get(u.id) ?? 0;
      const recording = recordingCount.get(u.id) ?? 0;
      return {
        id: u.id,
        name: u.name,
        slug: u.slug,
        instructors,
        recording,
        silent: Math.max(0, instructors - recording),
        workingHours: round(bucket?.workingHours ?? 0),
        otherHours: round(bucket?.otherHours ?? 0),
        lines: [...(bucket?.lines.values() ?? [])]
          .map((l) => ({ ...l, hours: round(l.hours) }))
          .sort((a, z) => z.hours - a.hours),
        lastRecordedOn: bucket?.lastDate ?? null,
      };
    });

    return NextResponse.json({
      period: { from, to },
      universities: rows,
      totals: {
        universities: rows.length,
        /* Universities where NOBODY recorded anything. Counted here rather than
         * left to the page, so the number cannot be derived two ways. */
        silentUniversities: rows.filter((r) => r.instructors > 0 && r.recording === 0).length,
        instructors: rows.reduce((n, r) => n + r.instructors, 0),
        recording: rows.reduce((n, r) => n + r.recording, 0),
        silent: rows.reduce((n, r) => n + r.silent, 0),
        workingHours: round(rows.reduce((n, r) => n + r.workingHours, 0)),
        otherHours: round(rows.reduce((n, r) => n + r.otherHours, 0)),
      },
    });
  },
  { roles: ["ADMIN"] },
);
