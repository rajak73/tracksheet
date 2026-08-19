import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { instructorWhere, narrowManager } from "@/server/auth/scope";
import { computeAnalytics } from "@/server/analytics/engine";

/**
 * The manager's dashboard, in one call.
 *
 * ── What this answers, and why it is not the worklog endpoint ──────────────
 * `/api/manager/worklog` answers "who did what, in this range" — it is the
 * table. This answers the three questions a manager opens the page with, none
 * of which are about a range they chose:
 *
 *     today        is my roster in? how many hours? who is missing?
 *     this month   which weeks were heavy, which were light?
 *     the mix      where did those hours actually go?
 *
 * Keeping them apart means the header figures do not shift when somebody pages
 * back to last Tuesday — "Logged Today" would be a lie the moment it followed
 * the table's date.
 *
 * ── Every figure is derived, none is stored ────────────────────────────────
 * All three come from `computeAnalytics`, the same engine the analytics page
 * and the instructor's own dashboard read. There is no separate dashboard
 * rollup to drift: a number here and the same number there are the same
 * computation over the same rows.
 *
 * ── The month is a grid of whole weeks, not a calendar month ───────────────
 * A week bar is only comparable to the bar beside it if both cover seven days,
 * so the month view runs Monday-to-Sunday across the weeks the month touches —
 * which is why the first bar can start in the previous month. The mix is
 * summed over exactly that same range, so the bars and the doughnut add up to
 * the same total instead of being two nearly-equal numbers a manager has to
 * reconcile.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const round = (n: number) => Math.round(n * 100) / 100;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `iso` — the product's week everywhere. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
}

export const GET = withAuth(async ({ scope, req }) => {
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  const month = sp.get("month");

  if (!date || !DAY.test(date)) {
    throw new ApiError(400, "INVALID_DATE", "Provide `date` as YYYY-MM-DD.");
  }
  if (!month || !MONTH.test(month)) {
    throw new ApiError(400, "INVALID_MONTH", "Provide `month` as YYYY-MM.");
  }

  // The roster, from the session. `narrowManager` pins a manager to their own
  // id and refuses any other; an admin reading this sees the whole university.
  /* ── Who this manager answers for ────────────────────────────────────────
   * Their own roster, plus — if they are the university's PRIMARY manager —
   * the instructors nobody leads yet. An unassigned instructor is in nobody's
   * roster by definition, so without this their work counts toward no
   * manager's figures at all and the dashboard reads as an empty team.
   */
  const mine = { ...instructorWhere(scope), ...narrowManager(scope, null), user: { isActive: true } };

  /* The primary manager OF THIS CALLER'S UNIVERSITY.
   *
   * This was `findFirst({ where: { primaryManagerId: { not: null } } })` with a
   * tenant filter that expanded to `{}` in both branches — so on a multi-tenant
   * install it returned whichever university happened to sort first, and a
   * primary manager of any OTHER university failed the comparison below. Their
   * unassigned instructors then belonged to no roster at all: absent from the
   * table, the counts and the approval queue, with nothing to say so. */
  const primary =
    scope.kind === "university"
      ? await prisma.university.findUnique({
          where: { id: scope.universityId },
          select: { primaryManagerId: true },
        })
      : null;
  const answersForUnassigned =
    scope.kind === "global" ||
    (scope.kind === "university" &&
      primary?.primaryManagerId != null &&
      primary.primaryManagerId === scope.managerId);

  const where = answersForUnassigned
    ? { OR: [mine, { ...instructorWhere(scope), managerId: null, user: { isActive: true } }] }
    : mine;

  const roster = await prisma.instructor.findMany({
    where,
    select: { id: true, universityId: true, university: { select: { timezone: true } } },
    orderBy: { createdAt: "asc" },
  });

  if (roster.length === 0) {
    return NextResponse.json({ timezone: null, today: null, month: null, distribution: [] });
  }

  const universityId = roster[0]!.universityId;

  /* The engine takes ONE manager filter, and "mine plus the unassigned" is not
   * one filter. So when both are in play the whole university is computed and
   * the rows are narrowed here, against the ids the query above already
   * authorised — the cheaper path is kept for the ordinary case. */
  const allowed = new Set(roster.map((r) => r.id));
  const managerId =
    scope.kind === "university" && !answersForUnassigned ? (scope.managerId ?? undefined) : undefined;

  // When the engine was given no manager filter it returned the whole
  // university, so the rows are narrowed to the ids the query above authorised.
  const keep = <T extends { instructorId: string }>(rows: T[]) =>
    managerId === undefined ? rows.filter((r) => allowed.has(r.instructorId)) : rows;

  const monthFrom = mondayOf(`${month}-01`);
  const monthTo = addDays(mondayOf(lastDayOfMonth(month)), 6);

  const [day, grid, types] = await Promise.all([
    /* Today AND yesterday in one pass, rather than the engine's own trend.
     * The trend gives a university-wide previous figure, and this dashboard is
     * about the people THIS manager answers for — so both days come back as
     * per-day rows and are summed over the same narrowed set. */
    computeAnalytics({ universityId, from: addDays(date, -1), to: date, managerId }),
    computeAnalytics({ universityId, from: monthFrom, to: monthTo, managerId }),
    prisma.activityType.findMany({ select: { code: true, label: true } }),
  ]);

  const labelOf = new Map(types.map((t) => [t.code, t.label]));

  /* ── Today ─────────────────────────────────────────────────────────────
   * "Logged" and "missing" use the product's own capacity rule, the same one
   * the worklog table colours its cells with: a day with no capacity is not
   * counted at all, so somebody on leave is neither logged nor missing.
   */
  const mineToday = keep(day.instructors);
  const yesterday = addDays(date, -1);

  const todayRows = mineToday.map((row) => {
    const today = row.days.find((d) => d.date === date);
    return {
      working: Boolean(today?.isWorkingDay) && (today?.capacityHours ?? 0) > 0,
      hours: today?.productiveHours ?? 0,
    };
  });

  const logged = todayRows.filter((r) => r.hours > 0).length;
  const missing = todayRows.filter((r) => r.working && r.hours <= 0).length;
  const expected = todayRows.filter((r) => r.working).length;

  const activities = await prisma.activityLog.count({
    where: {
      workDate: new Date(`${date}T00:00:00.000Z`),
      instructor: { ...instructorWhere(scope), ...narrowManager(scope, null), user: { isActive: true } },
    },
  });

  /* Summed from the rows this manager answers for, never from the engine's
   * university-wide totals — those would count instructors this dashboard is
   * not about. */
  const current = todayRows.reduce((n, r) => n + r.hours, 0);
  const previous = mineToday.reduce(
    (n, row) => n + (row.days.find((d) => d.date === yesterday)?.productiveHours ?? 0),
    0,
  );

  /* ── The month, week by week ───────────────────────────────────────────── */
  const perDate = new Map<string, number>();
  for (const row of keep(grid.instructors)) {
    for (const d of row.days) {
      perDate.set(d.date, (perDate.get(d.date) ?? 0) + d.productiveHours);
    }
  }

  const weeks: Array<{
    from: string;
    to: string;
    hours: number;
    /** No day of this week has happened yet — distinct from a week of zeroes. */
    future: boolean;
    current: boolean;
  }> = [];

  for (let start = monthFrom; start <= monthTo; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    let hours = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) hours += perDate.get(d) ?? 0;
    weeks.push({
      from: start,
      to: end,
      hours: round(hours),
      future: start > date,
      current: start <= date && date <= end,
    });
  }

  /* ── Where the hours went ───────────────────────────────────────────────
   * Summed over the SAME range as the bars, AND over the same people.
   *
   * This read `grid.totals.hoursByActivityType`, which is the engine's total
   * for whatever it was asked about. When the caller is the university's
   * primary manager the engine is deliberately run WITHOUT a manager filter —
   * that is how unassigned instructors get answered for — so the totals cover
   * every roster in the tenant. The week bars below were narrowed with
   * `keep()` and this was not, which meant a primary manager's doughnut showed
   * peer managers' hours and disagreed with the bars beside it on the same
   * screen. Two figures from one page cannot be allowed to describe two
   * different sets of people.
   */
  const byType: Record<string, number> = {};
  for (const row of keep(grid.instructors)) {
    for (const [code, hours] of Object.entries(row.hoursByActivityType)) {
      byType[code] = (byType[code] ?? 0) + hours;
    }
  }
  const mixTotal = Object.values(byType).reduce((n, h) => n + h, 0);
  const distribution = Object.entries(byType)
    .filter(([, hours]) => hours > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([code, hours]) => ({
      code,
      label: labelOf.get(code) ?? code,
      hours: round(hours),
      // Null rather than 0 when there is nothing to be a share of: "no hours
      // yet" and "0% of the hours" are different statements.
      pct: mixTotal > 0 ? round((hours / mixTotal) * 100) : null,
    }));

  return NextResponse.json({
    timezone: roster[0]!.university.timezone,
    today: {
      date,
      instructors: roster.length,
      expected,
      logged,
      missing,
      loggedPct: expected > 0 ? round((logged / expected) * 100) : null,
      hours: round(current),
      activities,
      yesterday: {
        hours: round(previous),
        // A percentage change against nothing is not 100%, it is unmeasurable.
        deltaPct: previous > 0 ? round(((current - previous) / previous) * 100) : null,
        direction:
          previous === 0 ? "UNKNOWN" : current > previous ? "UP" : current < previous ? "DOWN" : "FLAT",
      },
    },
    month: { month, from: monthFrom, to: monthTo, totalHours: round(mixTotal), weeks },
    distribution,
  });
}, { roles: ["MANAGER", "ADMIN"] });
