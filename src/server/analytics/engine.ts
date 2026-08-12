/**
 * The single deterministic analytics engine.
 *
 * Every consumer — manager dashboard, admin dashboard, report exports, and the
 * AI layer — calls THIS. Before, three separate implementations existed
 * (`utilization.ts`, `reports/generator.ts`, and inline code in the analytics
 * route) and they disagreed with each other whenever activities overlapped.
 * That is exactly what the "dashboard and report must show identical numbers"
 * requirement forbids, so there is now one path and the others delegate to it.
 *
 * Rules encoded here, and nowhere else:
 *
 *  - Worked time is the UNION of intervals, never the sum of durations. Two
 *    overlapping one-hour classes are 1.5 hours if they overlap by 30 minutes.
 *  - Capacity excludes non-working days, holidays, approved leave, and the
 *    university's configured break. It does NOT exclude opening/closing, which
 *    are recognised productive activities.
 *  - "No record" is MISSING_DATA, not zero hours worked. A day with no logs is
 *    reported separately and is never silently counted as unutilised.
 */

import { prisma } from "@/server/db";
import {
  computeDayWindows,
  type UniversityTimeConfig,
} from "@/server/time/schedule-windows";
import { workDateFor } from "@/server/time/workday";
import { loadUniversityConfig } from "@/server/universities/config";

const MS_PER_HOUR = 3_600_000;

export type Interval = { start: Date; end: Date };

export type DayBreakdown = {
  date: string;
  isWorkingDay: boolean;
  /** NOT_A_WORKING_DAY | HOLIDAY | LEAVE, or null on a working day. */
  nonWorkingReason: string | null;
  capacityHours: number;
  productiveHours: number;
  /** null when the day is MISSING_DATA — we do not know, so we do not guess. */
  unutilizedHours: number | null;
  hasData: boolean;
  openingLogged: boolean;
  closingLogged: boolean;
};

/** Actual vs configured target for one activity type over the period. */
export type WorkloadVariance = {
  activityTypeCode: string;
  targetHours: number;
  actualHours: number;
  /** actual - target. Negative means under target. */
  varianceHours: number;
  variancePct: number | null;
};

export type DeliverableProgress = {
  total: number;
  completed: number;
  overdue: number;
  targetQuantity: number;
  completedQuantity: number;
  /** Quantity completed as a percentage of quantity targeted. */
  completionPct: number | null;
  hoursSpent: number;
};

export type InstructorBreakdown = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  /** Capacity on working days that carry no activity records at all. */
  missingDataHours: number;
  utilizationPct: number | null;
  hoursByActivityType: Record<string, number>;
  /** Overlap detected between logged activities — a data-quality signal. */
  overlapHours: number;
  expectedWorkingDays: number;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
  workloadVariance: WorkloadVariance[];
  deliverables: DeliverableProgress;
  days: DayBreakdown[];
};

export type AnalyticsResult = {
  universityId: string;
  from: string;
  to: string;
  totals: {
    instructors: number;
    capacityHours: number;
    productiveHours: number;
    unutilizedHours: number;
    missingDataHours: number;
    utilizationPct: number | null;
    openingCompliancePct: number | null;
    closingCompliancePct: number | null;
    hoursByActivityType: Record<string, number>;
    workloadVariance: WorkloadVariance[];
    deliverables: DeliverableProgress;
  };
  instructors: InstructorBreakdown[];
  /**
   * Comparison against the immediately preceding period of equal length.
   * Present only when `includeTrend` was requested — computing it doubles the
   * query cost, so it is opt-in rather than paid for on every dashboard load.
   */
  trend?: TrendComparison;
};

export type TrendComparison = {
  previousFrom: string;
  previousTo: string;
  productiveHours: TrendPoint;
  utilizationPct: TrendPoint;
  hoursByActivityType: Record<string, TrendPoint>;
};

export type TrendPoint = {
  current: number | null;
  previous: number | null;
  /** current - previous, or null when either side is unmeasurable. */
  delta: number | null;
  direction: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
};

const round = (n: number) => Number(n.toFixed(2));

/** Union of intervals, in hours. Overlaps are merged, never added. */
export function unionHours(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());

  let total = 0;
  let curStart = sorted[0].start.getTime();
  let curEnd = sorted[0].end.getTime();

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i].start.getTime();
    const e = sorted[i].end.getTime();
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total / MS_PER_HOUR;
}

/** Naive sum minus union — how much double counting the raw logs contain. */
export function overlapHours(intervals: Interval[]): number {
  const naive = intervals.reduce(
    (acc, i) => acc + (i.end.getTime() - i.start.getTime()) / MS_PER_HOUR,
    0,
  );
  return Math.max(0, naive - unionHours(intervals));
}

/** Inclusive list of `YYYY-MM-DD` dates. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cursor = new Date(Date.UTC(fy, fm - 1, fd));
  const end = Date.UTC(ty, tm - 1, td);
  // Bounded so a reversed or absurd range cannot spin forever.
  while (cursor.getTime() <= end && out.length < 1000) {
    out.push(workDateFor(cursor, "UTC"));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * Capacity for one working day, in hours: the working window minus the
 * configured break. Opening/closing are NOT deducted — they are real work.
 */
function dayCapacityHours(config: UniversityTimeConfig, breakMin: number, date: string): number {
  const w = computeDayWindows(config, date);
  if (!w.isWorkingDay || !w.workingHours) return 0;
  return Math.max(0, (w.workingHours.durationMinutes - breakMin) / 60);
}

export type AnalyticsQuery = {
  universityId: string;
  from: string;
  to: string;
  /** Restrict to a single instructor (used by the self-scoped dashboard). */
  instructorId?: string;
  /** Also compute the preceding period for comparison. Off by default. */
  includeTrend?: boolean;
};

function trendPoint(current: number | null, previous: number | null): TrendPoint {
  if (current === null || previous === null) {
    return { current, previous, delta: null, direction: "UNKNOWN" };
  }
  const delta = round(current - previous);
  return {
    current,
    previous,
    delta,
    // A tolerance rather than exact equality: floating hours that differ in the
    // second decimal are not a trend.
    direction: Math.abs(delta) < 0.01 ? "FLAT" : delta > 0 ? "UP" : "DOWN",
  };
}

/**
 * The comparable period before [from, to].
 *
 * For a span of a week or less the window is shifted back a WHOLE WEEK rather
 * than by its own length, so weekday alignment is preserved. Shifting a Mon-Fri
 * window back five calendar days lands on Wed-Sun, which compares five working
 * days against three and reports a fall in teaching hours that never happened.
 * Longer spans shift by their own length, where the relative weekday mix
 * averages out.
 */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const span = eachDate(from, to).length;
  const shift = span <= 7 ? 7 : span;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shiftBack = (date: string) => {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - shift);
    return iso(d);
  };

  return { from: shiftBack(from), to: shiftBack(to) };
}

type DeliverableRow = {
  targetQuantity: number;
  dueDate: Date;
  status: string;
  logs: Array<{ quantityCompleted: number; hoursSpent: number }>;
};

/**
 * Completion for a reporting period covers deliverables that BELONG to that
 * period: ones with progress logged inside it, or falling due inside it.
 *
 * Counting every open deliverable regardless of date would make a one-week
 * report's denominator include work due months later, so the percentage would
 * move whenever unrelated work was assigned. A long-overdue item with no
 * activity in the window is a risk signal for the insights layer, not part of
 * this period's completion figure.
 */
function summariseDeliverables(
  rows: DeliverableRow[],
  periodStart: string,
  periodEnd: string,
): DeliverableProgress {
  const startMs = Date.parse(`${periodStart}T00:00:00.000Z`);
  const endMs = Date.parse(`${periodEnd}T23:59:59.999Z`);

  rows = rows.filter((d) => {
    const due = d.dueDate.getTime();
    return d.logs.length > 0 || (due >= startMs && due <= endMs);
  });
  let targetQuantity = 0;
  let completedQuantity = 0;
  let hoursSpent = 0;
  let completed = 0;
  let overdue = 0;

  for (const d of rows) {
    targetQuantity += d.targetQuantity;
    const done = d.logs.reduce((a, l) => a + l.quantityCompleted, 0);
    completedQuantity += done;
    hoursSpent += d.logs.reduce((a, l) => a + l.hoursSpent, 0);
    if (d.status === "COMPLETED") completed += 1;
    // Overdue is measured against the END of the period being reported, not
    // against "now" — otherwise a historical report changes as time passes.
    else if (d.dueDate.getTime() < endMs) overdue += 1;
  }

  return {
    total: rows.length,
    completed,
    overdue,
    targetQuantity,
    completedQuantity,
    completionPct: targetQuantity > 0 ? round((completedQuantity / targetQuantity) * 100) : null,
    hoursSpent: round(hoursSpent),
  };
}

export async function computeAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
  const { universityId, from, to } = query;
  const config = await loadUniversityConfig(universityId);

  const university = await prisma.university.findUniqueOrThrow({
    where: { id: universityId },
    select: { breakDurationMin: true },
  });
  const breakMin = university.breakDurationMin;

  const instructors = await prisma.instructor.findMany({
    where: {
      universityId,
      ...(query.instructorId ? { id: query.instructorId } : {}),
      user: { isActive: true },
    },
    select: {
      id: true,
      employeeCode: true,
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);

  const [logs, leaves, targets, deliverables] = await Promise.all([
    prisma.activityLog.findMany({
      where: {
        universityId,
        workDate: { gte: fromDate, lte: toDate },
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
      },
      select: {
        instructorId: true,
        workDate: true,
        startTime: true,
        endTime: true,
        activityType: {
          select: { code: true, countsAsProductive: true, isOncePerDay: true },
        },
      },
    }),
    prisma.leaveRequest.findMany({
      where: {
        universityId,
        status: "APPROVED",
        startDate: { lte: toDate },
        endDate: { gte: fromDate },
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
      },
      select: { instructorId: true, startDate: true, endDate: true },
    }),
    // Effective-dated targets: only those in force during the period.
    prisma.workloadTarget.findMany({
      where: {
        universityId,
        effectiveFrom: { lte: toDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromDate } }],
      },
      select: {
        instructorId: true,
        targetMinutes: true,
        periodType: true,
        activityType: { select: { code: true } },
      },
    }),
    prisma.deliverable.findMany({
      where: {
        universityId,
        deletedAt: null,
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
      },
      select: {
        id: true,
        instructorId: true,
        targetQuantity: true,
        dueDate: true,
        status: true,
        logs: {
          where: { workDate: { gte: fromDate, lte: toDate } },
          select: { quantityCompleted: true, hoursSpent: true },
        },
      },
    }),
  ]);

  const dates = eachDate(from, to);

  // instructorId -> date -> logs
  const byInstructorDate = new Map<string, Map<string, typeof logs>>();
  for (const log of logs) {
    const date = workDateFor(log.workDate, "UTC");
    let perDate = byInstructorDate.get(log.instructorId);
    if (!perDate) byInstructorDate.set(log.instructorId, (perDate = new Map()));
    const bucket = perDate.get(date);
    if (bucket) bucket.push(log);
    else perDate.set(date, [log]);
  }

  const leaveByInstructor = new Map<string, Array<{ start: string; end: string }>>();
  for (const l of leaves) {
    const list = leaveByInstructor.get(l.instructorId) ?? [];
    list.push({ start: workDateFor(l.startDate, "UTC"), end: workDateFor(l.endDate, "UTC") });
    leaveByInstructor.set(l.instructorId, list);
  }
  const onLeave = (instructorId: string, date: string) =>
    (leaveByInstructor.get(instructorId) ?? []).some((r) => date >= r.start && date <= r.end);

  const breakdowns: InstructorBreakdown[] = instructors.map((inst) => {
    const perDate = byInstructorDate.get(inst.id) ?? new Map<string, typeof logs>();

    let capacity = 0;
    let productive = 0;
    let unutilized = 0;
    let missing = 0;
    let overlap = 0;
    let expectedDays = 0;
    let openingCount = 0;
    let closingCount = 0;
    const hoursByType: Record<string, number> = {};
    const days: DayBreakdown[] = [];

    for (const date of dates) {
      const windows = computeDayWindows(config, date);
      const dayLogs = perDate.get(date) ?? [];
      const leave = onLeave(inst.id, date);

      // Approved leave removes the day from capacity entirely, so the
      // percentage is not punished for a day nobody expected work on.
      if (!windows.isWorkingDay || leave) {
        days.push({
          date,
          isWorkingDay: false,
          nonWorkingReason: leave ? "LEAVE" : windows.nonWorkingReason,
          capacityHours: 0,
          productiveHours: dayLogs.length
            ? round(
                unionHours(
                  dayLogs
                    .filter((l) => l.activityType.countsAsProductive)
                    .map((l) => ({ start: l.startTime, end: l.endTime })),
                ),
              )
            : 0,
          unutilizedHours: 0,
          hasData: dayLogs.length > 0,
          openingLogged: false,
          closingLogged: false,
        });
        continue;
      }

      expectedDays += 1;
      const dayCapacity = dayCapacityHours(config, breakMin, date);
      capacity += dayCapacity;

      const productiveIntervals = dayLogs
        .filter((l) => l.activityType.countsAsProductive)
        .map((l) => ({ start: l.startTime, end: l.endTime }));
      const dayProductive = unionHours(productiveIntervals);
      const dayOverlap = overlapHours(productiveIntervals);

      for (const l of dayLogs) {
        const hrs = (l.endTime.getTime() - l.startTime.getTime()) / MS_PER_HOUR;
        hoursByType[l.activityType.code] = round((hoursByType[l.activityType.code] ?? 0) + hrs);
      }

      const hasOpening = dayLogs.some(
        (l) => l.activityType.isOncePerDay && l.activityType.code === "DAILY_OPENING",
      );
      const hasClosing = dayLogs.some(
        (l) => l.activityType.isOncePerDay && l.activityType.code === "DAILY_CLOSING",
      );
      if (hasOpening) openingCount += 1;
      if (hasClosing) closingCount += 1;

      const hasData = dayLogs.length > 0;
      // The distinction that keeps analytics honest: a day with no records is
      // MISSING_DATA. Counting it as unutilised would assert the instructor
      // did nothing, which the data does not support.
      const dayUnutilized = hasData ? Math.max(0, dayCapacity - dayProductive) : null;

      productive += dayProductive;
      overlap += dayOverlap;
      if (dayUnutilized === null) missing += dayCapacity;
      else unutilized += dayUnutilized;

      days.push({
        date,
        isWorkingDay: true,
        nonWorkingReason: null,
        capacityHours: round(dayCapacity),
        productiveHours: round(dayProductive),
        unutilizedHours: dayUnutilized === null ? null : round(dayUnutilized),
        hasData,
        openingLogged: hasOpening,
        closingLogged: hasClosing,
      });
    }

    // ── Workload variance ────────────────────────────────────────────────
    // An instructor-specific target overrides the university default for the
    // same activity type; without that, a per-person target would be additive
    // rather than an override.
    const weeks = Math.max(1, dates.length / 7);
    const applicable = new Map<string, number>();
    for (const t of targets) {
      if (!t.activityType) continue;
      const isForThisInstructor = t.instructorId === inst.id;
      if (t.instructorId && !isForThisInstructor) continue;
      const code = t.activityType.code;
      // Scale the target to the requested period.
      const scaled =
        t.periodType === "WEEKLY"
          ? t.targetMinutes * weeks
          : t.periodType === "DAILY"
            ? t.targetMinutes * dates.length
            : t.periodType === "MONTHLY"
              ? (t.targetMinutes * dates.length) / 30
              : t.targetMinutes;
      if (isForThisInstructor || !applicable.has(code)) applicable.set(code, scaled);
    }

    const workloadVariance: WorkloadVariance[] = [...applicable.entries()].map(
      ([code, targetMinutes]) => {
        const targetHrs = round(targetMinutes / 60);
        const actualHrs = round(hoursByType[code] ?? 0);
        return {
          activityTypeCode: code,
          targetHours: targetHrs,
          actualHours: actualHrs,
          varianceHours: round(actualHrs - targetHrs),
          variancePct: targetHrs > 0 ? round(((actualHrs - targetHrs) / targetHrs) * 100) : null,
        };
      },
    );

    // ── Deliverable completion ───────────────────────────────────────────
    const mine = deliverables.filter((d) => d.instructorId === inst.id);
    const deliverableProgress = summariseDeliverables(mine, from, to);

    return {
      instructorId: inst.id,
      instructorName: inst.user.name,
      employeeCode: inst.employeeCode,
      capacityHours: round(capacity),
      productiveHours: round(productive),
      unutilizedHours: round(unutilized),
      missingDataHours: round(missing),
      utilizationPct: capacity > 0 ? round((productive / capacity) * 100) : null,
      hoursByActivityType: hoursByType,
      overlapHours: round(overlap),
      expectedWorkingDays: expectedDays,
      openingCompliancePct: expectedDays > 0 ? round((openingCount / expectedDays) * 100) : null,
      closingCompliancePct: expectedDays > 0 ? round((closingCount / expectedDays) * 100) : null,
      workloadVariance,
      deliverables: deliverableProgress,
      days,
    };
  });

  const sum = (pick: (b: InstructorBreakdown) => number) =>
    round(breakdowns.reduce((acc, b) => acc + pick(b), 0));

  const totalCapacity = sum((b) => b.capacityHours);
  const totalProductive = sum((b) => b.productiveHours);
  const totalExpectedDays = breakdowns.reduce((a, b) => a + b.expectedWorkingDays, 0);
  const totalOpenings = breakdowns.reduce(
    (a, b) => a + b.days.filter((d) => d.openingLogged).length,
    0,
  );
  const totalClosings = breakdowns.reduce(
    (a, b) => a + b.days.filter((d) => d.closingLogged).length,
    0,
  );

  const totalsByType: Record<string, number> = {};
  for (const b of breakdowns) {
    for (const [code, hrs] of Object.entries(b.hoursByActivityType)) {
      totalsByType[code] = round((totalsByType[code] ?? 0) + hrs);
    }
  }

  // Totals reuse the same helper so a university figure is the same
  // calculation as an instructor one, not a parallel implementation.
  const totalVariance = new Map<string, { target: number; actual: number }>();
  for (const b of breakdowns) {
    for (const v of b.workloadVariance) {
      const acc = totalVariance.get(v.activityTypeCode) ?? { target: 0, actual: 0 };
      acc.target += v.targetHours;
      acc.actual += v.actualHours;
      totalVariance.set(v.activityTypeCode, acc);
    }
  }

  let trend: TrendComparison | undefined;
  if (query.includeTrend) {
    const prev = previousPeriod(from, to);
    // instructorId is carried through so a self-scoped trend compares like
    // with like rather than the instructor against their whole university.
    const previousResult = await computeAnalytics({
      universityId,
      from: prev.from,
      to: prev.to,
      instructorId: query.instructorId,
    });

    const codes = new Set([
      ...Object.keys(totalsByType),
      ...Object.keys(previousResult.totals.hoursByActivityType),
    ]);

    trend = {
      previousFrom: prev.from,
      previousTo: prev.to,
      productiveHours: trendPoint(totalProductive, previousResult.totals.productiveHours),
      utilizationPct: trendPoint(
        totalCapacity > 0 ? round((totalProductive / totalCapacity) * 100) : null,
        previousResult.totals.utilizationPct,
      ),
      hoursByActivityType: Object.fromEntries(
        [...codes].map((code) => [
          code,
          trendPoint(totalsByType[code] ?? 0, previousResult.totals.hoursByActivityType[code] ?? 0),
        ]),
      ),
    };
  }

  return {
    universityId,
    from,
    to,
    trend,
    totals: {
      instructors: breakdowns.length,
      capacityHours: totalCapacity,
      productiveHours: totalProductive,
      unutilizedHours: sum((b) => b.unutilizedHours),
      missingDataHours: sum((b) => b.missingDataHours),
      utilizationPct: totalCapacity > 0 ? round((totalProductive / totalCapacity) * 100) : null,
      openingCompliancePct:
        totalExpectedDays > 0 ? round((totalOpenings / totalExpectedDays) * 100) : null,
      closingCompliancePct:
        totalExpectedDays > 0 ? round((totalClosings / totalExpectedDays) * 100) : null,
      hoursByActivityType: totalsByType,
      workloadVariance: [...totalVariance.entries()].map(([code, v]) => ({
        activityTypeCode: code,
        targetHours: round(v.target),
        actualHours: round(v.actual),
        varianceHours: round(v.actual - v.target),
        variancePct: v.target > 0 ? round(((v.actual - v.target) / v.target) * 100) : null,
      })),
      deliverables: summariseDeliverables(deliverables, from, to),
    },
    instructors: breakdowns,
  };
}
