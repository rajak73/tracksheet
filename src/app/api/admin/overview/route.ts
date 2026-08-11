import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { computeAnalytics } from "@/server/analytics/engine";
import { resolvePeriod } from "@/server/analytics/period";

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

    const perUniversity = await Promise.all(
      universities.map(async (u) => {
        // Each university's period is resolved in ITS OWN timezone, so "this
        // week" is not silently the admin's week.
        const period = resolvePeriod(req.nextUrl.searchParams, u.timezone);
        const a = await computeAnalytics({ universityId: u.id, from: period.from, to: period.to });
        return {
          universityId: u.id,
          name: u.name,
          slug: u.slug,
          timezone: u.timezone,
          from: period.from,
          to: period.to,
          instructors: a.totals.instructors,
          capacityHours: a.totals.capacityHours,
          productiveHours: a.totals.productiveHours,
          unutilizedHours: a.totals.unutilizedHours,
          missingDataHours: a.totals.missingDataHours,
          utilizationPct: a.totals.utilizationPct,
          openingCompliancePct: a.totals.openingCompliancePct,
          closingCompliancePct: a.totals.closingCompliancePct,
          hoursByActivityType: a.totals.hoursByActivityType,
        };
      }),
    );

    const round = (n: number) => Number(n.toFixed(2));
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
      },
      universities: perUniversity,
    });
  },
  { roles: ["ADMIN"] },
);
