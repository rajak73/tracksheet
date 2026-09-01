import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { STORED_METRICS } from "@/server/analytics/stored-metrics";
import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";
import { averageActiveMinutes, type UniversityDay } from "@/domain/average-hours";

/**
 * Active-Instructor Average Hours, per university, for one period.
 *
 * ── Why an average and not a percentage ───────────────────────────────────
 * A utilisation percentage measures recorded time against a configured
 * capacity, and the client's own experience of that was the reason it went:
 * a day of meetings scored exactly like a day of lectures, so the number moved
 * for reasons nobody could act on and answered no question anybody had asked.
 *
 * ── Why "active" and not "the whole roster" ────────────────────────────────
 * A full-roster denominator was built first and then explicitly superseded —
 * see `src/domain/average-hours.ts`. The confirmed rule divides only by
 * instructor-days that were actually active: a day with two instructors
 * logging time and one who logged nothing contributes 2 to the count, not 3.
 *
 * ── Read from the daily metrics, never from the activity rows ─────────────
 * `UniversityDailyMetric` already holds `activeInstructorMinutes` and
 * `activeInstructorCount`, precomputed by the rollup (`rollup.ts`) at the same
 * time it computes everything else — see the schema doc on those columns.
 * Week and Month here are a handful of indexed reads over that table and one
 * division; neither ever queries `ActivityLog`. `tests/average-hours.test.ts`
 * asserts this against Postgres's own per-table read counters, not just by
 * reading this comment.
 *
 * ── No model call, and there could not be one ─────────────────────────────
 * Every figure here is a SUM and a division over stored rows. See the rule in
 * the README and the guard in `tests/no-gemini-in-arithmetic.test.ts`.
 *
 * ── Manager and instructor counts are roster metadata, not inputs ─────────
 * `managerCount` and `instructorCount` below answer "how big is this
 * university's team", read from `Manager`/`Instructor` directly — the same
 * tables and the same `user: { isActive: true }` filter `admin/overview`
 * already uses for roster size, so this card cannot disagree with that one
 * about what counts as "on the roster". They are never read from
 * `UniversityDailyMetric` and never touch `averageActiveMinutes`: a
 * university with one manager and one with four, given identical activity,
 * produce the identical average — see `tests/average-hours.test.ts`.
 */

type View = "day" | "week" | "month";

/**
 * The period a view covers, in the UNIVERSITY's own zone.
 *
 * Each university resolves its own, because "this week" in Kolkata and "this
 * week" in New York are not the same seven days, and an admin looking at both
 * is entitled to see each university's real week rather than theirs.
 */
function periodFor(view: View, today: string): { from: string; to: string } {
  if (view === "day") return { from: today, to: today };

  const at = new Date(`${today}T00:00:00.000Z`);
  if (view === "week") {
    // Monday-first, matching every other week in this product.
    const offset = (at.getUTCDay() + 6) % 7;
    const monday = new Date(at);
    monday.setUTCDate(monday.getUTCDate() - offset);
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }

  const first = `${today.slice(0, 7)}-01`;
  const next = new Date(`${first}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0); // the last day of this month
  return { from: first, to: next.toISOString().slice(0, 10) };
}

export const GET = withAuth(
  async ({ req }) => {
    const raw = req.nextUrl.searchParams.get("view") ?? "week";
    if (raw !== "day" && raw !== "week" && raw !== "month") {
      throw new ApiError(400, "INVALID_VIEW", "`view` must be day, week or month.");
    }
    const view: View = raw;

    /* An explicit anchor is for tests and for navigating back; without one the
     * period is the CURRENT one, which is what every other screen defaults to. */
    const anchor = req.nextUrl.searchParams.get("on");
    if (anchor) assertValidDate(anchor);

    const universities = await prisma.university.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { id: true, name: true, slug: true, timezone: true },
      orderBy: { name: "asc" },
    });
    const universityIds = universities.map((u) => u.id);

    // Period-independent roster metadata, batched ONCE across every
    // university rather than once per row below — mirrors the identical
    // pattern in `admin/overview/route.ts`. Deliberately two separate
    // `groupBy` calls against `Manager`/`Instructor`, not a read of anything
    // this feature's own calculation touches.
    const [managerRows, instructorRows] = await Promise.all([
      prisma.manager.groupBy({
        by: ["universityId"],
        where: { universityId: { in: universityIds }, user: { isActive: true } },
        _count: { _all: true },
      }),
      prisma.instructor.groupBy({
        by: ["universityId"],
        where: { universityId: { in: universityIds }, user: { isActive: true } },
        _count: { _all: true },
      }),
    ]);
    const managerCountByUniversity = new Map(managerRows.map((r) => [r.universityId, r._count._all]));
    const instructorCountByUniversity = new Map(
      instructorRows.map((r) => [r.universityId, r._count._all]),
    );

    const now = new Date();
    const rows = await Promise.all(
      universities.map(async (university) => {
        const today = anchor ?? workDateFor(now, university.timezone);
        const period = periodFor(view, today);

        // The one query this view makes: a range of a single indexed table.
        // Day, Week and Month differ only in how wide `period` is — the read
        // shape and the formula below never change with it.
        const days = await prisma.universityDailyMetric.findMany({
          where: {
            universityId: university.id,
            metricDate: {
              gte: new Date(`${period.from}T00:00:00.000Z`),
              lte: new Date(`${period.to}T00:00:00.000Z`),
            },
          },
          select: { metricDate: true, activeInstructorMinutes: true, activeInstructorCount: true },
          orderBy: { metricDate: "asc" },
        });

        const shaped: UniversityDay[] = days.map((d) => ({
          date: d.metricDate.toISOString().slice(0, 10),
          activeMinutes: d.activeInstructorMinutes,
          activeCount: d.activeInstructorCount,
        }));

        const average = averageActiveMinutes(shaped);
        return {
          id: university.id,
          name: university.name,
          slug: university.slug,
          period,
          // The numerator and denominator the average was taken from, kept on
          // the payload rather than only the quotient — so a screen can say
          // "N active instructor-days" beside the figure instead of just the
          // number, and so this response is checkable without recomputing it.
          activeMinutes: shaped.reduce((n, d) => n + d.activeMinutes, 0),
          activeInstructorDays: shaped.reduce((n, d) => n + d.activeCount, 0),
          averageMinutes: average.minutes,
          // Roster size, NOT the calculation's denominator — see the file doc.
          // An instructor with nothing active this period still counts here.
          managerCount: managerCountByUniversity.get(university.id) ?? 0,
          instructorCount: instructorCountByUniversity.get(university.id) ?? 0,
        };
      }),
    );

    /* Averaged from `UniversityDailyMetric`, which no longer has a writer.
       See `STORED_METRICS` — the rows still travel so the shape holds, and the
       flag is what stops them being printed as fact. */
    return NextResponse.json({ view, universities: rows, storedMetrics: STORED_METRICS });
  },
  { roles: ["ADMIN"] },
);
