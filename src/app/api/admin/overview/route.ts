import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { STORED_METRICS } from "@/server/analytics/stored-metrics";
import { worklogFigures } from "@/server/analytics/worklog-figures";
import { BRIEF_TYPE } from "@/server/ai/brief-type";
import { resolvePeriod } from "@/server/analytics/period";
import { toDateOnly } from "@/server/time/workday";

/**
 * Cross-university roll-up for the admin dashboard.
 *
 * Every figure comes from the same engine the manager dashboard and the report
 * exports use, so an admin total is always the sum of numbers a manager would
 * recognise.
 *
 * ── Query count ─────────────────────────────────────────────────────────────
 * A first version issued 4 queries PER university (aggregate, coverage
 * findMany, active-instructor count, activity-type findMany), on top of a
 * handful of fixed queries (the university list itself, and the platform-wide
 * manager/instructor/insight counts) that do not scale with N. Measured via
 * Prisma's own query-event log against real seeded rows, isolating just the
 * per-university portion: 3 universities -> 12 queries, 10 -> 40, 100 -> 400 —
 * exactly 4N, confirming that loop as the actual N+1 rather than an estimate.
 *
 * `resolvePeriod` only varies per university when NO explicit ?from=&to= is
 * given (the default "trailing 7 days" is resolved in each university's own
 * timezone, so two universities can land on different calendar days near
 * midnight). Everything else about the per-university figures is identical
 * SQL shape run once per row — the classic N+1 pattern. Universities are
 * grouped by their resolved {from, to} (almost always ONE group, since an
 * explicit period is shared by every caller), and each group is fetched with
 * one `groupBy`/`findMany({where: {universityId: {in: [...]}}})` covering every
 * university in it. The same isolated portion becomes 1 (active-instructor
 * counts, period-independent, batched once for every university) + 3 per
 * DISTINCT PERIOD, regardless of N — O(1) for the common case, O(number of
 * timezones) at worst, and
 * never O(N).
 */
const round = (n: number) => Number(n.toFixed(2));

type MetricAgg = {
  _sum: {
    capacityMinutes: number | null;
    productiveMinutes: number | null;
    unutilizedMinutes: number | null;
    missingDataMinutes: number | null;
    /* Compliance is summed rather than averaged — see `ratioPct`. The stored
     * daily percentage is still the right figure for a single day, and is not
     * read here. */
    expectedInstructorDays: number | null;
  };
  _max: { activeInstructors: number | null };
  universityId: string;
};


export const GET = withAuth(
  async ({ req }) => {
    const universities = await prisma.university.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, timezone: true },
    });

    const [totalManagers, totalInstructors, openInsights] = await Promise.all([
      prisma.manager.count(),
      prisma.instructor.count({ where: { user: { isActive: true } } }),
      /* Briefs excluded. Every generated brief is written status NEW and
       * cannot be dismissed — `PATCH /api/insights/[id]` deliberately 404s on
       * them — and nothing deletes expired rows, so counting them made this a
       * number that only ever goes up. `expiresAt` stops a brief being SERVED,
       * not counted. "Open insights" means insights somebody can still act on. */
      prisma.aiInsight.count({ where: { status: "NEW", type: { not: BRIEF_TYPE } } }),
    ]);

    // Period-independent, so it is batched ONCE across every university
    // rather than once per group below.
    const activeInstructorRows = await prisma.instructor.groupBy({
      by: ["universityId"],
      where: { universityId: { in: universities.map((u) => u.id) }, user: { isActive: true } },
      _count: { _all: true },
    });
    const activeInstructorCountByUniversity = new Map(
      activeInstructorRows.map((r) => [r.universityId, r._count._all]),
    );

    // Group universities by their resolved period. Almost always one group.
    const periodOf = new Map(
      universities.map((u) => [u.id, resolvePeriod(req.nextUrl.searchParams, u.timezone)]),
    );
    const groups = new Map<string, { period: { from: string; to: string }; universityIds: string[] }>();
    for (const u of universities) {
      const period = periodOf.get(u.id)!;
      const key = `${period.from}|${period.to}`;
      const existing = groups.get(key);
      if (existing) existing.universityIds.push(u.id);
      else groups.set(key, { period, universityIds: [u.id] });
    }

    // Reads the daily rollup rather than aggregating ActivityLog. The raw-table
    // version measured as a Parallel Seq Scan (399 ms over 3.9M rows at only
    // 100 universities) and no index can fix a full-platform aggregate. Raw
    // activity remains the source of truth and is used for drill-down (§60).
    const perUniversityById = new Map<string, ReturnType<typeof buildRow>>();
    /** Deliverable quantity per university over that university's period. */
    const deliverablesByUniversity = new Map<string, number>();

    function buildRow(args: {
      u: (typeof universities)[number];
      period: { from: string; to: string };
      agg: MetricAgg | undefined;
      coveredDays: number;
    }) {
      const { u, period, agg, coveredDays } = args;
      const expectedDays =
        Math.round(
          (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000,
        ) + 1;
      // A university with no active instructors produces no metric rows at
      // all — the rollup iterates instructor-days, so there is genuinely
      // nothing to summarise. Without this, an empty tenant would report
      // "incomplete" forever and show a permanent false warning.
      //
      // The instructor count MUST come from the Instructor table, not from
      // `agg._max.activeInstructors`: that field is read out of the metric
      // rows, so a genuinely stale rollup has no rows, reports zero
      // instructors, and would mask exactly the staleness this check
      // exists to catch.
      const activeInstructorCount = activeInstructorCountByUniversity.get(u.id) ?? 0;
      const coverage = {
        expectedDays,
        coveredDays,
        complete: activeInstructorCount === 0 || coveredDays >= expectedDays,
      };

      const toHours = (m: number | null | undefined) => round((m ?? 0) / 60);
      const capacityHours = toHours(agg?._sum.capacityMinutes);
      const productiveHours = toHours(agg?._sum.productiveMinutes);

      return {
        universityId: u.id,
        name: u.name,
        slug: u.slug,
        timezone: u.timezone,
        from: period.from,
        to: period.to,
        instructors: agg?._max.activeInstructors ?? 0,
        deliverables: deliverablesByUniversity.get(u.id) ?? 0,
        capacityHours,
        productiveHours,
        unutilizedHours: toHours(agg?._sum.unutilizedMinutes),
        missingDataHours: toHours(agg?._sum.missingDataMinutes),
        recordedHoursPct: capacityHours > 0 ? round((productiveHours / capacityHours) * 100) : null,
        coverage,
      };
    }

    for (const { period, universityIds } of groups.values()) {
      const dateWhere = {
        universityId: { in: universityIds },
        metricDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
      };

      const [aggRows, coveredRows, deliverableRows] = await Promise.all([
        prisma.universityDailyMetric.groupBy({
          by: ["universityId"],
          where: dateWhere,
          _max: { activeInstructors: true },
          /* Summed, not averaged.
           *
           * `_avg` of the stored daily percentages is an unweighted mean of
           * ratios, and the live engine computes a ratio of sums. The two agree
           * only when every day has the same denominator, which approved leave
           * and part-week holidays make untrue. Two figures for the same
           * question, on two screens a click apart. */
          _sum: {
            capacityMinutes: true,
            productiveMinutes: true,
            unutilizedMinutes: true,
            missingDataMinutes: true,
            expectedInstructorDays: true,
          },
        }),
        // ── Rollup coverage ─────────────────────────────────────────────────
        // These figures come from a CACHE. If the scheduler has not yet
        // summarised part of the requested window, the aggregate above is
        // silently computed over fewer days than the caller asked for — and
        // this endpoint would report a smaller capacity and a HIGHER
        // utilisation than the live engine does for the same period. That is
        // exactly how an admin and a manager end up quoting different numbers
        // for the same university.
        //
        // The fix is not to guess the missing days: it is to say so. The
        // response reports which days are actually covered, so the UI can warn
        // instead of presenting incomplete data as complete.
        prisma.universityDailyMetric.findMany({
          where: dateWhere,
          select: { universityId: true, metricDate: true },
          distinct: ["universityId", "metricDate"],
        }),
        // Deliverable quantity for the same window. Not derivable from the
        // daily metric rows — those summarise TIME — so it is read from the
        // logs themselves, grouped in one query rather than per university.
        prisma.deliverableLog.groupBy({
          by: ["universityId"],
          where: {
            universityId: { in: universityIds },
            workDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
          },
          _sum: { quantityCompleted: true },
        }),
      ]);

      for (const row of deliverableRows) {
        deliverablesByUniversity.set(row.universityId, row._sum.quantityCompleted ?? 0);
      }

      const aggByUniversity = new Map(aggRows.map((r) => [r.universityId, r]));

      const coveredDaysByUniversity = new Map<string, number>();
      for (const row of coveredRows) {
        coveredDaysByUniversity.set(
          row.universityId,
          (coveredDaysByUniversity.get(row.universityId) ?? 0) + 1,
        );
      }

      for (const universityId of universityIds) {
        const u = universities.find((x) => x.id === universityId)!;
        perUniversityById.set(
          universityId,
          buildRow({
            u,
            period,
            agg: aggByUniversity.get(universityId),
            coveredDays: coveredDaysByUniversity.get(universityId) ?? 0,
          }),
        );
      }
    }

    // Preserve the original name-sorted order, not group-insertion order.
    /* ── The vocabulary-free figures, per university ─────────────────────
     * Computed per university rather than once globally, because each resolves
     * its own period from its own timezone — `periodOf` above. Summing across
     * a single window would quietly report one tenant's Monday inside another's
     * Sunday. */
    const instructorsByUniversity = new Map<string, string[]>();
    for (const row of await prisma.instructor.findMany({
      where: { universityId: { in: universities.map((u) => u.id) } },
      select: { id: true, universityId: true },
    })) {
      const list = instructorsByUniversity.get(row.universityId) ?? [];
      list.push(row.id);
      instructorsByUniversity.set(row.universityId, list);
    }
    const figuresByUniversity = new Map(
      await Promise.all(
        universities.map(async (u) => {
          const period = periodOf.get(u.id)!;
          return [
            u.id,
            await worklogFigures(instructorsByUniversity.get(u.id) ?? [], period.from, period.to),
          ] as const;
        }),
      ),
    );

    const perUniversity = universities.map((u) => perUniversityById.get(u.id)!);

    const sum = (pick: (u: (typeof perUniversity)[number]) => number) =>
      round(perUniversity.reduce((acc, u) => acc + pick(u), 0));

    const capacityHours = sum((u) => u.capacityHours);
    const productiveHours = sum((u) => u.productiveHours);

    /* ── What replaced teaching and learning hours ────────────────────────
     * The dashboard led with "global teaching hours" and "global learning
     * hours", both read out of the TEACHING and LEARNING codes. That is a
     * two-item taxonomy at the top of the admin dashboard: keeping those
     * numbers would have meant keeping a classification system for exactly two
     * labels, and every instructor being made to file their work under one of
     * them.
     *
     * These three need no shared vocabulary — they count days and add up hours,
     * which mean the same thing in every instructor's own words. See
     * `worklogFigures`. Read from `WorklogEntry` rather than the stored
     * metrics, so they are real figures rather than ones marked unavailable
     * beside them. */
    const figures = [...figuresByUniversity.values()].reduce(
      (acc, f) => ({
        totalHours: Math.round((acc.totalHours + f.totalHours) * 100) / 100,
        daysLogged: acc.daysLogged + f.daysLogged,
        instructorsLogging: acc.instructorsLogging + f.instructorsLogging,
      }),
      { totalHours: 0, daysLogged: 0, instructorsLogging: 0 },
    );

    return NextResponse.json({
      overview: {
        totalUniversities: universities.length,
        totalManagers,
        totalInstructors,
        totalDeliverables: perUniversity.reduce((n, u) => n + u.deliverables, 0),
        openInsights,
        capacityHours,
        productiveHours,
        unutilizedHours: sum((u) => u.unutilizedHours),
        missingDataHours: sum((u) => u.missingDataHours),
        recordedHoursPct: capacityHours > 0 ? round((productiveHours / capacityHours) * 100) : null,
        /* Hours, days and how many people filed. No category anywhere: see the
           note above `figures`, and `worklogFigures` for why these three are
           the only cross-instructor figures that survive. */
        totalHours: figures.totalHours,
        daysLogged: figures.daysLogged,
        instructorsLogging: figures.instructorsLogging,
        // True only when every university's rollup covers the whole requested
        // window. When false the figures above are computed over fewer days
        // than were asked for and will not match the live analytics engine.
        rollupComplete: perUniversity.every((u) => u.coverage.complete),
        /* ── Every hours figure above is currently unbelievable ───────────
         * They are summed from `UniversityDailyMetric`, a cache over
         * `ActivityLog` — and the worklog writes `WorklogEntry` now, with
         * nothing left to refresh the cache. The numbers still come down the
         * wire because deleting them from the payload would break every
         * consumer at once; the flag is what tells a consumer not to print
         * them. See `STORED_METRICS`. */
        storedMetrics: STORED_METRICS,
      },
      universities: perUniversity,
    });
  },
  { roles: ["ADMIN"] },
);
