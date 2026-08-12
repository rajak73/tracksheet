import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";
import { toDateOnly } from "@/server/time/workday";

/**
 * Precomputed daily metrics for one instructor, straight from the rollup.
 *
 * The live engine is still fast for a single instructor (measured at 1.3 ms
 * over 3.9M activity rows, because (instructorId, workDate) is indexed), so the
 * dashboards deliberately keep using it for correctness-critical reads. This
 * endpoint exposes the summary so it is actually consumed and verified rather
 * than being a write-only table nobody checks.
 */
export const GET = withAuth<{ id: string }>(async ({ params, scope, req }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: { id: true, universityId: true },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  assertCanReadInstructor(scope, instructor);

  const config = await loadUniversityConfig(instructor.universityId);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);

  const weeks = await prisma.instructorWeeklyMetric.findMany({
    where: {
      instructorId: instructor.id,
      periodEnd: { gte: toDateOnly(period.from) },
      periodStart: { lte: toDateOnly(period.to) },
    },
    orderBy: { periodStart: "asc" },
  });

  const rows = await prisma.instructorDailyMetric.findMany({
    where: {
      instructorId: instructor.id,
      metricDate: { gte: toDateOnly(period.from), lte: toDateOnly(period.to) },
    },
    orderBy: { metricDate: "asc" },
  });

  const toHours = (m: number) => Number((m / 60).toFixed(2));
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    Number(rows.reduce((a, r) => a + pick(r), 0).toFixed(2));

  const capacityHours = toHours(sum((r) => r.capacityMinutes));
  const productiveHours = toHours(sum((r) => r.productiveMinutes));

  return NextResponse.json({
    from: period.from,
    to: period.to,
    totals: {
      capacityHours,
      productiveHours,
      unutilizedHours: toHours(sum((r) => r.unutilizedMinutes)),
      missingDataHours: toHours(sum((r) => r.missingDataMinutes)),
      utilizationPct:
        capacityHours > 0 ? Number(((productiveHours / capacityHours) * 100).toFixed(2)) : null,
    },
    weeks: weeks.map((w) => ({
      periodStart: w.periodStart.toISOString().slice(0, 10),
      periodEnd: w.periodEnd.toISOString().slice(0, 10),
      capacityHours: toHours(w.capacityMinutes),
      productiveHours: toHours(w.productiveMinutes),
      unutilizedHours: toHours(w.unutilizedMinutes),
      missingDataHours: toHours(w.missingDataMinutes),
      utilizationPct: w.utilizationPercent,
      openingCompliancePct: w.openingCompliancePct,
      closingCompliancePct: w.closingCompliancePct,
      expectedWorkingDays: w.expectedWorkingDays,
    })),
    days: rows.map((r) => ({
      date: r.metricDate.toISOString().slice(0, 10),
      capacityHours: toHours(r.capacityMinutes),
      productiveHours: toHours(r.productiveMinutes),
      unutilizedHours: toHours(r.unutilizedMinutes),
      missingDataHours: toHours(r.missingDataMinutes),
      isWorkingDay: r.isWorkingDay,
      nonWorkingReason: r.nonWorkingReason,
      openingLogged: r.openingLogged,
      closingLogged: r.closingLogged,
    })),
  });
});
