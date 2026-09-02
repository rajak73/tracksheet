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
import { computeAnalytics, eachDate } from "@/server/analytics/engine";
import { toDateOnly } from "@/server/time/workday";

const round2 = (n: number) => Number(n.toFixed(2));
const toMinutes = (hours: number) => Math.round(hours * 60);

export type RollupResult = {
  universityId: string;
  from: string;
  to: string;
  instructorDays: number;
  universityDays: number;
  instructorWeeks: number;
};

/**
 * Monday-start (ISO) week containing `date`, as YYYY-MM-DD bounds.
 *
 * Weeks are anchored to Monday rather than to the university's first working
 * day: a tenant working Mon-Sat and one working Mon-Fri must still bucket into
 * comparable weeks, otherwise cross-university comparison is meaningless.
 */
export function isoWeekBounds(date: string): { start: string; end: string } {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // getUTCDay: 0=Sun..6=Sat -> offset back to Monday.
  const offset = (dt.getUTCDay() + 6) % 7;
  const start = new Date(dt);
  start.setUTCDate(start.getUTCDate() - offset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

/**
 * Recomputes daily metrics for one university over a date range.
 *
 * Idempotent: upserts on (instructorId, metricDate) and (universityId,
 * metricDate), so re-running over the same window corrects rather than
 * duplicates. That matters because a late-submitted activity log changes a day
 * that was already summarised.
 */
/**
 * Recompute one day's stored metrics, right after something changed it.
 *
 * ── Why a mutation has to ask for this ────────────────────────────────────
 * The metric tables are a cache with no way to tell that its source moved.
 * `computedAt` records when a row was last written, not whether the activities
 * beneath it have changed since, and the scheduler only ever recomputes a short
 * trailing window — three days by default.
 *
 * So editing an activity, deleting one, or revoking approved leave on any day
 * older than that window left the stored figures permanently wrong, with
 * nothing in the data to show it. The admin dashboard reads those rows; the
 * live engine does not, so the two silently diverged and only the dashboard was
 * wrong.
 *
 * Deliberately not fatal to the caller. The mutation has already happened and
 * succeeded; a failure to re-summarise it is a stale cache, not a failed edit,
 * and the next scheduled or manual rollup over that period corrects it. Turning
 * a successful edit into a 500 because a cache refresh failed would be the
 * worse trade.
 */
export async function recomputeDay(
  universityId: string,
  from: string,
  to: string = from,
): Promise<void> {
  try {
    await rollupUniversityDaily(universityId, from, to);
  } catch {
    /* Stale, not broken — see above. */
  }
}

export async function rollupUniversityDaily(
  universityId: string,
  from: string,
  to: string,
): Promise<RollupResult> {
  /* No `includeInactive` here, deliberately — and no exclusion either.
   *
   * This table IS the history: `upsert` with `update: data` overwrites, so
   * re-running the rollup over a past window rewrites it. While the engine
   * dropped everyone deactivated, that meant a day a departed instructor really
   * worked was rewritten as though they had not been there, every time the
   * scheduler's rolling window or an admin's manual recompute passed over it.
   *
   * `includeInactive: true` is not the fix. It would also charge their capacity
   * for windows AFTER they left, understating everyone else's utilization to
   * correct the opposite error.
   *
   * The engine now answers by DATE instead: somebody who left is included for
   * the days they were employed and charged nothing beyond them. So the plain
   * call is the correct one, and history stops moving.
   */
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
      workingDays: number;
      /* The Active-Instructor Average Hours feature's own two numbers —
       * see the schema doc on `UniversityDailyMetric` for the "active"
       * definition. Kept apart from `activeInstructors`/`productive` above:
       * those count and sum EVERY instructor with a day row, including the
       * ones who logged nothing, which is precisely what this feature must
       * not do. */
      activeInstructorMinutes: number;
      activeInstructorCount: number;
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
        workingDays: 0,
        activeInstructorMinutes: 0,
        activeInstructorCount: 0,
      };

      const missingMinutes =
        day.isWorkingDay && !day.hasData ? toMinutes(day.capacityHours) : 0;
      const unutilizedMinutes =
        day.unutilizedHours === null ? 0 : toMinutes(day.unutilizedHours);
      const productiveMinutes = toMinutes(day.productiveHours);

      instructorRows.push({
        universityId,
        instructorId: instructor.instructorId,
        metricDate: toDateOnly(day.date),
        capacityMinutes: toMinutes(day.capacityHours),
        productiveMinutes,
        unutilizedMinutes,
        missingDataMinutes: missingMinutes,
        overlapMinutes: 0,
        /* `minutesByActivityType` is gone with the types it keyed on. */
        isWorkingDay: day.isWorkingDay,
        nonWorkingReason: day.nonWorkingReason,
        utilizationPercent:
          day.capacityHours > 0 ? round2((day.productiveHours / day.capacityHours) * 100) : null,
      });

      /* The per-type bucket is gone: it fed the admin dashboard's teaching
         and learning figures, which are replaced by hours, days and coverage. */

      bucket.activeInstructors += 1;
      bucket.capacity += toMinutes(day.capacityHours);
      bucket.productive += productiveMinutes;
      bucket.unutilized += unutilizedMinutes;
      bucket.missing += missingMinutes;
      if (day.isWorkingDay) bucket.workingDays += 1;
      // Strictly greater than zero — a submission that summed to exactly 0m
      // is the same case as no submission at all, and both are excluded here
      // rather than folded in as a zero. See the schema doc on the column.
      if (productiveMinutes > 0) {
        bucket.activeInstructorMinutes += productiveMinutes;
        bucket.activeInstructorCount += 1;
      }
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
    activeInstructorMinutes: b.activeInstructorMinutes,
    activeInstructorCount: b.activeInstructorCount,
    utilizationPercent: b.capacity > 0 ? round2((b.productive / b.capacity) * 100) : null,
    /* The counts, kept as well as the ratio.
     *
     * A day's percentage is the right figure for a day. A PERIOD's is not the
     * average of them: the live engine divides openings by expected
     * instructor-days across the whole period, and averaging daily percentages
     * gives a different answer whenever the denominators differ — which
     * approved leave and part-week holidays guarantee. These were already
     * computed here and discarded, so the dashboard had no way to add them up
     * the way the engine does. */
    expectedInstructorDays: b.workingDays,
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

  const instructorWeeks = await rollupInstructorWeekly(universityId, from, to);

  return {
    universityId,
    from,
    to,
    instructorDays: instructorRows.length,
    universityDays: universityRows.length,
    instructorWeeks,
  };
}

/**
 * Derives weekly metrics from the daily rows just written.
 *
 * Deliberately derived from InstructorDailyMetric rather than recomputed from
 * ActivityLog: recomputing would be a third implementation of the same maths
 * and could disagree with the daily rows it sits above. Summing the dailies
 * guarantees week = sum(its days) by construction.
 *
 * Any week TOUCHED by the window is recomputed in full, not just the part
 * inside it — a Wednesday rollup must not write a week row containing only
 * Monday-to-Wednesday and present it as the week's total.
 */
async function rollupInstructorWeekly(
  universityId: string,
  from: string,
  to: string,
): Promise<number> {
  const weeks = new Map<string, { start: string; end: string }>();
  for (const date of eachDate(from, to)) {
    const bounds = isoWeekBounds(date);
    weeks.set(bounds.start, bounds);
  }

  let written = 0;

  for (const { start, end } of weeks.values()) {
    const days = await prisma.instructorDailyMetric.findMany({
      where: {
        universityId,
        metricDate: { gte: toDateOnly(start), lte: toDateOnly(end) },
      },
      select: {
        instructorId: true,
        capacityMinutes: true,
        productiveMinutes: true,
        unutilizedMinutes: true,
        missingDataMinutes: true,
        isWorkingDay: true,
      },
    });

    const byInstructor = new Map<string, typeof days>();
    for (const d of days) {
      const list = byInstructor.get(d.instructorId);
      if (list) list.push(d);
      else byInstructor.set(d.instructorId, [d]);
    }

    const rows = [...byInstructor.entries()].map(([instructorId, ds]) => {
      const capacity = ds.reduce((a, d) => a + d.capacityMinutes, 0);
      const productive = ds.reduce((a, d) => a + d.productiveMinutes, 0);
      const workingDays = ds.filter((d) => d.isWorkingDay).length;

      return {
        universityId,
        instructorId,
        periodStart: toDateOnly(start),
        periodEnd: toDateOnly(end),
        capacityMinutes: capacity,
        productiveMinutes: productive,
        unutilizedMinutes: ds.reduce((a, d) => a + d.unutilizedMinutes, 0),
        missingDataMinutes: ds.reduce((a, d) => a + d.missingDataMinutes, 0),
        utilizationPercent: capacity > 0 ? round2((productive / capacity) * 100) : null,
        expectedWorkingDays: workingDays,
      };
    });

    await prisma.$transaction(
      rows.map((data) =>
        prisma.instructorWeeklyMetric.upsert({
          where: {
            instructorId_periodStart: {
              instructorId: data.instructorId,
              periodStart: data.periodStart,
            },
          },
          create: data,
          update: data,
        }),
      ),
    );
    written += rows.length;
  }

  return written;
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
