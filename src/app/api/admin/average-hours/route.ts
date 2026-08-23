import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";
import { averageMinutesPerInstructor, type UniversityDay } from "@/domain/average-hours";

/**
 * Average working hours per instructor, per university, for one period.
 *
 * ── Why an average and not a percentage ───────────────────────────────────
 * A utilisation percentage measures recorded time against a configured
 * capacity, and the client's own experience of that was the reason it went:
 * a day of meetings scored exactly like a day of lectures, so the number moved
 * for reasons nobody could act on and answered no question anybody had asked.
 *
 * An average states a fact and implies no target. Eleven hours across nine
 * instructors is eleven hours across nine instructors; whether that is good is
 * a judgement for the person reading it, made with everything else they know.
 *
 * ── Read from the daily metrics, never from the activity rows ─────────────
 * `UniversityDailyMetric` already holds one row per university per day with
 * the minutes and the roster size on it. Summing thirty of those is thirty
 * rows; the same question asked of `ActivityLog` at the scale the client
 * operates — a hundred universities of a hundred instructors — is over a
 * million, which is measured elsewhere in this codebase as thirty seconds and
 * a heap the container cannot hold.
 *
 * ── No model call, and there could not be one ─────────────────────────────
 * Every figure here is a SUM and a division over stored rows. See the rule in
 * the README and the guard in `tests/no-gemini-in-arithmetic.test.ts`.
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

    const now = new Date();
    const rows = await Promise.all(
      universities.map(async (university) => {
        const today = anchor ?? workDateFor(now, university.timezone);
        const period = periodFor(view, today);

        const days = await prisma.universityDailyMetric.findMany({
          where: {
            universityId: university.id,
            metricDate: {
              gte: new Date(`${period.from}T00:00:00.000Z`),
              lte: new Date(`${period.to}T00:00:00.000Z`),
            },
          },
          select: { metricDate: true, productiveMinutes: true, activeInstructors: true },
          orderBy: { metricDate: "asc" },
        });

        const shaped: UniversityDay[] = days.map((d) => ({
          date: d.metricDate.toISOString().slice(0, 10),
          minutes: d.productiveMinutes,
          roster: d.activeInstructors,
        }));

        const average = averageMinutesPerInstructor(shaped);
        return {
          id: university.id,
          name: university.name,
          slug: university.slug,
          period,
          totalMinutes: shaped.reduce((n, d) => n + d.minutes, 0),
          roster: average.roster,
          averageMinutes: average.minutes,
        };
      }),
    );

    return NextResponse.json({ view, universities: rows });
  },
  { roles: ["ADMIN"] },
);
