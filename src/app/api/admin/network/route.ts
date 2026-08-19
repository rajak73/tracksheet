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

    if (!DAY.test(from) || !DAY.test(to) || from > to) {
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

    // Three queries, none of them per-university: the list, the head count, and
    // the entries. Adding a university adds rows, never round trips.
    const [universities, instructorCounts, logs] = await Promise.all([
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
      prisma.activityLog.findMany({
        where: {
          workDate: { gte: toDateOnly(from), lte: toDateOnly(to) },
          // Same rule as every other Working Hours reader: an activity marked
          // MISSED or EXCUSED did not happen, so it is not time with students.
          status: { notIn: [...DID_NOT_HAPPEN] },
        },
        select: {
          universityId: true,
          instructorId: true,
          workDate: true,
          startTime: true,
          endTime: true,
          activityType: { select: { code: true, label: true } },
          deliverableType: { select: { isCountable: true } },
        },
      }),
    ]);

    const headCount = new Map(instructorCounts.map((r) => [r.universityId, r._count._all]));

    type Bucket = {
      workingHours: number;
      otherHours: number;
      lines: Map<string, Line>;
      recorded: Set<string>;
      lastDate: string | null;
    };
    const buckets = new Map<string, Bucket>();
    const bucketFor = (id: string) => {
      let bucket = buckets.get(id);
      if (!bucket) {
        bucket = {
          workingHours: 0,
          otherHours: 0,
          lines: new Map(),
          recorded: new Set(),
          lastDate: null,
        };
        buckets.set(id, bucket);
      }
      return bucket;
    };

    for (const log of logs) {
      const bucket = bucketFor(log.universityId);
      // From the instants, never a clock subtraction: an entry that crosses
      // midnight comes out negative that way.
      const hours = (log.endTime.getTime() - log.startTime.getTime()) / 3_600_000;
      const countable = countsAsWorkingHours(
        log.activityType.code,
        log.deliverableType ? log.deliverableType.isCountable : null,
      );

      if (countable) bucket.workingHours += hours;
      else bucket.otherHours += hours;

      // Split by countability as well as by category, for the same reason the
      // sheets do: one category can hold both kinds, and merging them makes a
      // line whose hours do not match what it contributes.
      const key = `${log.activityType.code} ${countable}`;
      const line = bucket.lines.get(key) ?? {
        code: log.activityType.code,
        label: log.activityType.label,
        hours: 0,
        countable,
      };
      line.hours += hours;
      bucket.lines.set(key, line);

      bucket.recorded.add(log.instructorId);
      const day = log.workDate.toISOString().slice(0, 10);
      if (!bucket.lastDate || day > bucket.lastDate) bucket.lastDate = day;
    }

    const rows = universities.map((u) => {
      const bucket = buckets.get(u.id);
      const instructors = headCount.get(u.id) ?? 0;
      const recording = bucket?.recorded.size ?? 0;
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
