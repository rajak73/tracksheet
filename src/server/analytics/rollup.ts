/**
 * Daily metric rollup (§29).
 *
 * Why this exists: the admin dashboard query measured as a Parallel Seq Scan
 * over ActivityLog — 399 ms across 3.9M rows at only 100 universities. No index
 * fixes a full-platform aggregate, so the read path has to change: aggregate
 * once per day here, and let dashboards read the rollup.
 *
 * Critically, this does NOT reimplement the workload maths. It calls
 * `computeAnalytics`, the same engine the dashboards and reports use, so a
 * summary row can never disagree with a drill-down into the raw activity that
 * produced it. Reimplementing the maths for speed is exactly how the reporting
 * and dashboard numbers diverged before.
 *
 * Raw ActivityLog remains the source of truth. These tables are a cache that
 * can be rebuilt from it at any time (§60).
 */

import { prisma } from "@/server/db";
import { computeAnalytics } from "@/server/analytics/engine";
import { toDateOnly } from "@/server/time/workday";

const round2 = (n: number) => Number(n.toFixed(2));
const toMinutes = (hours: number) => Math.round(hours * 60);

export type RollupResult = {
  universityId: string;
  from: string;
  to: string;
  instructorDays: number;
  universityDays: number;
};

/**
 * Recomputes daily metrics for one university over a date range.
 *
 * Idempotent: upserts on (instructorId, metricDate) and (universityId,
 * metricDate), so re-running over the same window corrects rather than
 * duplicates. That matters because a late-submitted activity log changes a day
 * that was already summarised.
 */
export async function rollupUniversityDaily(
  universityId: string,
  from: string,
  to: string,
): Promise<RollupResult> {
  const analytics = await computeAnalytics({ universityId, from, to });

  // Accumulates the university-level row while walking instructor days, so the
  // university total is by construction the sum of its instructors.
  const perDate = new Map<
    string,
    {
      activeInstructors: number;
      capacity: number;
      productive: number;
      unutilized: number;
      missing: number;
      byType: Record<string, number>;
      openings: number;
      closings: number;
      workingDays: number;
    }
  >();

  const instructorRows: Array<Parameters<typeof prisma.instructorDailyMetric.create>[0]["data"]> =
    [];

  for (const instructor of analytics.instructors) {
    for (const day of instructor.days) {
      const bucket = perDate.get(day.date) ?? {
        activeInstructors: 0,
        capacity: 0,
        productive: 0,
        unutilized: 0,
        missing: 0,
        byType: {},
        openings: 0,
        closings: 0,
        workingDays: 0,
      };

      const missingMinutes =
        day.isWorkingDay && !day.hasData ? toMinutes(day.capacityHours) : 0;
      const unutilizedMinutes =
        day.unutilizedHours === null ? 0 : toMinutes(day.unutilizedHours);

      instructorRows.push({
        universityId,
        instructorId: instructor.instructorId,
        metricDate: toDateOnly(day.date),
        capacityMinutes: toMinutes(day.capacityHours),
        productiveMinutes: toMinutes(day.productiveHours),
        unutilizedMinutes,
        missingDataMinutes: missingMinutes,
        overlapMinutes: 0,
        minutesByActivityType: {},
        isWorkingDay: day.isWorkingDay,
        nonWorkingReason: day.nonWorkingReason,
        openingLogged: day.openingLogged,
        closingLogged: day.closingLogged,
        utilizationPercent:
          day.capacityHours > 0 ? round2((day.productiveHours / day.capacityHours) * 100) : null,
      });

      bucket.activeInstructors += 1;
      bucket.capacity += toMinutes(day.capacityHours);
      bucket.productive += toMinutes(day.productiveHours);
      bucket.unutilized += unutilizedMinutes;
      bucket.missing += missingMinutes;
      if (day.isWorkingDay) bucket.workingDays += 1;
      if (day.openingLogged) bucket.openings += 1;
      if (day.closingLogged) bucket.closings += 1;
      perDate.set(day.date, bucket);
    }
  }

  // Written in chunks: a single 900k-row transaction would hold locks far too
  // long on a table dashboards are reading.
  const CHUNK = 500;
  for (let i = 0; i < instructorRows.length; i += CHUNK) {
    const slice = instructorRows.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((data) =>
        prisma.instructorDailyMetric.upsert({
          where: {
            instructorId_metricDate: {
              instructorId: data.instructorId as string,
              metricDate: data.metricDate as Date,
            },
          },
          create: data,
          update: data,
        }),
      ),
    );
  }

  const universityRows = [...perDate.entries()].map(([date, b]) => ({
    universityId,
    metricDate: toDateOnly(date),
    activeInstructors: b.activeInstructors,
    capacityMinutes: b.capacity,
    productiveMinutes: b.productive,
    unutilizedMinutes: b.unutilized,
    missingDataMinutes: b.missing,
    minutesByActivityType: b.byType,
    utilizationPercent: b.capacity > 0 ? round2((b.productive / b.capacity) * 100) : null,
    openingCompliancePct:
      b.workingDays > 0 ? round2((b.openings / b.workingDays) * 100) : null,
    closingCompliancePct:
      b.workingDays > 0 ? round2((b.closings / b.workingDays) * 100) : null,
  }));

  await prisma.$transaction(
    universityRows.map((data) =>
      prisma.universityDailyMetric.upsert({
        where: {
          universityId_metricDate: {
            universityId: data.universityId,
            metricDate: data.metricDate,
          },
        },
        create: data,
        update: data,
      }),
    ),
  );

  return {
    universityId,
    from,
    to,
    instructorDays: instructorRows.length,
    universityDays: universityRows.length,
  };
}

/**
 * Rolls up every active university. This is the unit a scheduler would invoke
 * nightly; it is written as a plain async function so it can be driven by a
 * script today and by a BullMQ worker later without changing the logic.
 */
export async function rollupAllUniversities(from: string, to: string): Promise<RollupResult[]> {
  const universities = await prisma.university.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true },
  });

  const results: RollupResult[] = [];
  // Sequential on purpose: this is a background job competing with live traffic
  // for the same connection pool, so throughput matters less than not starving
  // request handlers.
  for (const u of universities) {
    results.push(await rollupUniversityDaily(u.id, from, to));
  }
  return results;
}
