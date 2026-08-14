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
 * Scale note: this computes analytics per university on demand. That is fine at
 * the current scale but is the first thing that should move to a precomputed
 * summary table once the university count grows.
 */
const round = (n: number) => Number(n.toFixed(2));

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

    // Reads the daily rollup rather than aggregating ActivityLog. The raw-table
    // version measured as a Parallel Seq Scan (399 ms over 3.9M rows at only
    // 100 universities) and no index can fix a full-platform aggregate. Raw
    // activity remains the source of truth and is used for drill-down (§60).
    const perUniversity = await Promise.all(
      universities.map(async (u) => {
        // Each university's period is resolved in ITS OWN timezone, so "this
        // week" is not silently the admin's week.
        const period = resolvePeriod(req.nextUrl.searchParams, u.timezone);

        const agg = await prisma.universityDailyMetric.aggregate({
          where: {
            universityId: u.id,
            metricDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
          },
          _sum: {
            capacityMinutes: true,
            productiveMinutes: true,
            unutilizedMinutes: true,
            missingDataMinutes: true,
          },
          _max: { activeInstructors: true },
          _avg: { openingCompliancePct: true, closingCompliancePct: true },
        });

        // ── Rollup coverage ───────────────────────────────────────────────
        // These figures come from a CACHE. If the scheduler has not yet
        // summarised part of the requested window, the aggregate above is
        // silently computed over fewer days than the caller asked for — and
        // this endpoint would report a smaller capacity and a HIGHER
        // utilisation than the live engine does for the same period. That is
        // exactly how an admin and a manager end up quoting different numbers
        // for the same university.
        //
        // The fix is not to guess the missing days: it is to say so. The
        // response now reports which days are actually covered, so the UI can
        // warn instead of presenting incomplete data as complete.
        const covered = await prisma.universityDailyMetric.findMany({
          where: {
            universityId: u.id,
            metricDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
          },
          select: { metricDate: true },
          distinct: ["metricDate"],
          orderBy: { metricDate: "asc" },
        });
        const expectedDays =
          Math.round(
            (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) /
              86_400_000,
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
        const activeInstructorCount = await prisma.instructor.count({
          where: { universityId: u.id, user: { isActive: true } },
        });
        const coverage = {
          expectedDays,
          coveredDays: covered.length,
          complete: activeInstructorCount === 0 || covered.length >= expectedDays,
        };

        // Prisma cannot aggregate inside a JSON column, so the per-type
        // breakdown is summed here over the same (universityId, metricDate)
        // rows the aggregate above already covers.
        const typeRows = await prisma.universityDailyMetric.findMany({
          where: {
            universityId: u.id,
            metricDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
          },
          select: { minutesByActivityType: true },
        });
        const byType: Record<string, number> = {};
        for (const row of typeRows) {
          for (const [code, minutes] of Object.entries(
            (row.minutesByActivityType ?? {}) as Record<string, number>,
          )) {
            byType[code] = (byType[code] ?? 0) + Number(minutes);
          }
        }

        const toHours = (m: number | null) => round((m ?? 0) / 60);
        const capacityHours = toHours(agg._sum.capacityMinutes);
        const productiveHours = toHours(agg._sum.productiveMinutes);

        return {
          universityId: u.id,
          name: u.name,
          slug: u.slug,
          timezone: u.timezone,
          from: period.from,
          to: period.to,
          instructors: agg._max.activeInstructors ?? 0,
          capacityHours,
          productiveHours,
          unutilizedHours: toHours(agg._sum.unutilizedMinutes),
          missingDataHours: toHours(agg._sum.missingDataMinutes),
          utilizationPct: capacityHours > 0 ? round((productiveHours / capacityHours) * 100) : null,
          openingCompliancePct:
            agg._avg.openingCompliancePct === null ? null : round(agg._avg.openingCompliancePct),
          closingCompliancePct:
            agg._avg.closingCompliancePct === null ? null : round(agg._avg.closingCompliancePct),
          hoursByActivityType: Object.fromEntries(
            Object.entries(byType).map(([code, minutes]) => [code, round(minutes / 60)]),
          ),
          coverage,
        };
      }),
    );

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
