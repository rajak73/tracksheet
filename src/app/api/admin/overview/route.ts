import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
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
 * findMany, active-instructor count, activity-type findMany) on top of 4 fixed
 * queries — Q(N) = 4N + 8, so 100 universities meant ~408 round trips on every
 * dashboard load.
 *
 * `resolvePeriod` only varies per university when NO explicit ?from=&to= is
 * given (the default "trailing 7 days" is resolved in each university's own
 * timezone, so two universities can land on different calendar days near
 * midnight). Everything else about the per-university figures is identical
 * SQL shape run once per row — the classic N+1 pattern. Universities are
 * grouped by their resolved {from, to} (almost always ONE group, since an
 * explicit period is shared by every caller), and each group is fetched with
 * one `groupBy`/`findMany({where: {universityId: {in: [...]}}})` covering every
 * university in it. Query count becomes 8 fixed + 1 (active-instructor counts,
 * period-independent, batched once for every university) + 3 per DISTINCT
 * PERIOD — O(1) for the common case, O(number of timezones) at worst, and
 * never O(N).
 */
const round = (n: number) => Number(n.toFixed(2));

type MetricAgg = {
  _sum: {
    capacityMinutes: number | null;
    productiveMinutes: number | null;
    unutilizedMinutes: number | null;
    missingDataMinutes: number | null;
  };
  _max: { activeInstructors: number | null };
  _avg: { openingCompliancePct: number | null; closingCompliancePct: number | null };
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
      prisma.aiInsight.count({ where: { status: "NEW" } }),
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

    function buildRow(args: {
      u: (typeof universities)[number];
      period: { from: string; to: string };
      agg: MetricAgg | undefined;
      coveredDays: number;
      byType: Record<string, number>;
    }) {
      const { u, period, agg, coveredDays, byType } = args;
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
        capacityHours,
        productiveHours,
        unutilizedHours: toHours(agg?._sum.unutilizedMinutes),
        missingDataHours: toHours(agg?._sum.missingDataMinutes),
        utilizationPct: capacityHours > 0 ? round((productiveHours / capacityHours) * 100) : null,
        openingCompliancePct:
          agg?._avg.openingCompliancePct == null ? null : round(agg._avg.openingCompliancePct),
        closingCompliancePct:
          agg?._avg.closingCompliancePct == null ? null : round(agg._avg.closingCompliancePct),
        hoursByActivityType: Object.fromEntries(
          Object.entries(byType).map(([code, minutes]) => [code, round(minutes / 60)]),
        ),
        coverage,
      };
    }

    for (const { period, universityIds } of groups.values()) {
      const dateWhere = {
        universityId: { in: universityIds },
        metricDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
      };

      const [aggRows, coveredRows, typeRows] = await Promise.all([
        prisma.universityDailyMetric.groupBy({
          by: ["universityId"],
          where: dateWhere,
          _sum: {
            capacityMinutes: true,
            productiveMinutes: true,
            unutilizedMinutes: true,
            missingDataMinutes: true,
          },
          _max: { activeInstructors: true },
          _avg: { openingCompliancePct: true, closingCompliancePct: true },
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
        // Prisma cannot aggregate inside a JSON column, so the per-type
        // breakdown is summed here in application code over the same rows the
        // aggregate above already covers.
        prisma.universityDailyMetric.findMany({
          where: dateWhere,
          select: { universityId: true, minutesByActivityType: true },
        }),
      ]);

      const aggByUniversity = new Map(aggRows.map((r) => [r.universityId, r]));

      const coveredDaysByUniversity = new Map<string, number>();
      for (const row of coveredRows) {
        coveredDaysByUniversity.set(
          row.universityId,
          (coveredDaysByUniversity.get(row.universityId) ?? 0) + 1,
        );
      }

      const byTypeByUniversity = new Map<string, Record<string, number>>();
      for (const row of typeRows) {
        const byType = byTypeByUniversity.get(row.universityId) ?? {};
        for (const [code, minutes] of Object.entries(
          (row.minutesByActivityType ?? {}) as Record<string, number>,
        )) {
          byType[code] = (byType[code] ?? 0) + Number(minutes);
        }
        byTypeByUniversity.set(row.universityId, byType);
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
            byType: byTypeByUniversity.get(universityId) ?? {},
          }),
        );
      }
    }

    // Preserve the original name-sorted order, not group-insertion order.
    const perUniversity = universities.map((u) => perUniversityById.get(u.id)!);

    const sum = (pick: (u: (typeof perUniversity)[number]) => number) =>
      round(perUniversity.reduce((acc, u) => acc + pick(u), 0));

    const capacityHours = sum((u) => u.capacityHours);
    const productiveHours = sum((u) => u.productiveHours);

    // Global hours per activity type, so "global teaching hours" and "global
    // learning hours" are real measurements rather than a single lumped total.
    const hoursByActivityType: Record<string, number> = {};
    for (const u of perUniversity) {
      for (const [code, hrs] of Object.entries(u.hoursByActivityType)) {
        hoursByActivityType[code] = round((hoursByActivityType[code] ?? 0) + hrs);
      }
    }

    return NextResponse.json({
      overview: {
        totalUniversities: universities.length,
        totalManagers,
        totalInstructors,
        openInsights,
        capacityHours,
        productiveHours,
        unutilizedHours: sum((u) => u.unutilizedHours),
        missingDataHours: sum((u) => u.missingDataHours),
        utilizationPct: capacityHours > 0 ? round((productiveHours / capacityHours) * 100) : null,
        teachingHours: hoursByActivityType.TEACHING ?? 0,
        learningHours: hoursByActivityType.LEARNING ?? 0,
        hoursByActivityType,
        // True only when every university's rollup covers the whole requested
        // window. When false the figures above are computed over fewer days
        // than were asked for and will not match the live analytics engine.
        rollupComplete: perUniversity.every((u) => u.coverage.complete),
      },
      universities: perUniversity,
    });
  },
  { roles: ["ADMIN"] },
);
