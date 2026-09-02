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

/* `countsTowardProductive` is gone.
 *
 * It excluded MISSED and EXCUSED activity from productive hours — an
 * `ActivityStatus` on `ActivityLog`. A `WorklogEntry` has no equivalent: an
 * instructor writes the hours they worked, and there is no status on that row
 * meaning "these hours did not happen". */


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
  /** Hours per activity type for THIS day, so a daily rollup can store it. */
};

/* `WorkloadVariance` is gone.
 *
 * It was actual-versus-target hours PER ACTIVITY TYPE, configured on
 * `WorkloadTarget` and keyed on the sixteen types. Without the types there is
 * no feature: a target of "8 hours of TEACHING a week" cannot be expressed
 * against free text, and rebuilding it against total hours would be a different
 * feature with a different meaning. Both tables held zero rows, in dev and in
 * test, so nothing configured was lost.
 */

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
  /** Current employment state. Historical rows for former staff carry `false`. */
  isActive: boolean;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  /** Capacity on working days that carry no activity records at all. */
  missingDataHours: number;
  recordedHoursPct: number | null;
  /** Overlap detected between logged activities — a data-quality signal. */
  overlapHours: number;
  expectedWorkingDays: number;
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
    recordedHoursPct: number | null;
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
  recordedHoursPct: TrendPoint;
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
  /**
   * Include instructors whose user account is deactivated. Off by default, so
   * every existing caller keeps its current meaning. Historical reporting sets
   * it; operational dashboards must not.
   */
  includeInactive?: boolean;
  /**
   * Restrict to one manager's roster. `undefined` means "no manager filter"
   * (every instructor in the university); `null` means "those with no manager",
   * which is how an admin reviews who still needs assigning. The distinction
   * matters, so this is deliberately not a plain optional string.
   */
  managerId?: string | null;
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
  const breakMin = config.breakDurationMin;

  // Deactivated staff are excluded BY DEFAULT, because every operational
  // surface (dashboards, utilisation, notifications, insights) is about who is
  // working now. Historical REPORTING is the exception: someone who left in
  // September did real work in August, and a report for August that silently
  // drops them is wrong. `includeInactive` is opt-in per call so this stays a
  // reporting concession rather than a global change of meaning — see
  // tracker.ts, the only caller that sets it.
  const instructors = await prisma.instructor.findMany({
    where: {
      universityId,
      ...(query.instructorId ? { id: query.instructorId } : {}),
      /* Somebody who left in September did real work in August, and a report
       * for August that silently drops them is wrong — the same reasoning as
       * `includeInactive`, applied by DATE so it needs no opt-in.
       *
       * Without this the stored metrics changed retroactively: the rollup
       * upserts with `update: data`, so re-running it over a past window after
       * someone departed rewrote days they had really worked as though they had
       * not been there. `includeInactive: true` is not the fix — it would also
       * charge their capacity for windows AFTER they left, understating
       * utilization for everyone else. The per-day skip below is what makes
       * this exact rather than merely different. */
      ...(query.includeInactive
        ? {}
        : {
            user: {
              OR: [{ isActive: true }, { deletedAt: { gte: new Date(`${from}T00:00:00.000Z`) } }],
            },
          }),
      // `undefined` leaves the roster unfiltered; `null` selects the
      // unassigned. `"managerId" in query` distinguishes the two — a plain
      // truthiness test would silently turn "show me the unassigned" into
      // "show me everyone".
      ...("managerId" in query ? { managerId: query.managerId } : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      // `deletedAt` is when they left. The capacity loop needs it per DAY.
      user: { select: { name: true, isActive: true, deletedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);

  const [logs, leaves, deliverables] = await Promise.all([
    /* ── The engine reads WorklogEntry ──────────────────────────────────
     * It read `ActivityLog`: many rows a day, each a clock interval, unioned so
     * two overlapping entries were not counted twice.
     *
     * A day is one row now, carrying the hours the instructor entered. There
     * are no intervals to union and none to overlap — which removes a class of
     * arithmetic rather than reimplementing it, and means the figure on screen
     * is the figure they typed. */
    prisma.worklogEntry.findMany({
      where: {
        universityId,
        logDate: { gte: fromDate, lte: toDate },
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
      },
      select: {
        instructorId: true,
        logDate: true,
        workingHours: true,
        status: true,
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
    prisma.deliverable.findMany({
      where: {
        universityId,
        deletedAt: null,
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
        /* Must track the instructor filter above — ALL of it.
         *
         * It tracked the roster and not the population. `instructors[]` leaves
         * out anybody who had already gone before this period, and this did
         * not, so `totals.deliverables` counted work belonging to people who
         * are not among the rows it sits above: a university total that is not
         * the sum of its own parts.
         *
         * Both conditions live on the same `instructor` key, so they are built
         * together — two separate spreads of `instructor` would silently
         * overwrite one another. */
        instructor: {
          ...("managerId" in query ? { managerId: query.managerId } : {}),
          ...(query.includeInactive
            ? {}
            : {
                user: {
                  OR: [
                    { isActive: true },
                    { deletedAt: { gte: new Date(`${from}T00:00:00.000Z`) } },
                  ],
                },
              }),
        },
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
    const date = workDateFor(log.logDate, "UTC");
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
    const days: DayBreakdown[] = [];

    /* The day they left, in the university's zone. Their last working day still
     * counts; everything after it is not theirs to be measured on. */
    const lastDay = inst.user.deletedAt ? workDateFor(inst.user.deletedAt, config.timezone) : null;

    for (const date of dates) {
      // Employed on this date? A departed instructor keeps every day they
      // worked and is charged for none after. Work already recorded is still
      // counted below — an absence of capacity is not an erasure of history.
      const employed = lastDay === null || date <= lastDay;

      const windows = computeDayWindows(config, date);
      const dayLogs = perDate.get(date) ?? [];
      const leave = onLeave(inst.id, date);

      // Productive hours and the per-type split are computed for every day,
      // working or not, and always folded into the running totals below. A
      // holiday or an approved leave day does not erase work someone actually
      // logged on it — and the rollup (rollup.ts) sums every day's
      // `productiveHours` unconditionally, so the engine's own total has to
      // include the same days or the two disagree on the same period.
      /* Every recorded hour is productive now.
       *
       * `countsAsProductive` was a flag on `ActivityType` — sixteen rows, each
       * declaring whether time filed under it counted. With no types there is
       * nothing to declare it on, and no basis for the product to decide that
       * some of somebody's recorded work does not count as work. */
      /* One row per instructor per day, so this sums at most one number.
         `unionHours` and `overlapHours` are gone with the intervals they
         resolved: two entries cannot overlap when there is one entry. */
      const dayProductive = dayLogs.reduce((n, l) => n + Number(l.workingHours), 0);
      const dayOverlap = 0;

      /* Every recorded row, split by category — NOT only the productive ones.
       *
       * That is deliberate and is under test ("UNUTILIZED time is recorded but
       * is not productive"). This split answers "where did the recorded time
       * go", and known idle time is part of that answer; `productiveHours`
       * answers a different question and excludes it. An audit read the
       * difference as a defect, which it is not — hence this note, so the next
       * one does not "fix" it either.
       *
       * What WAS wrong: the running total was rounded on every addition, and
       * again per day, and again when university totals were folded. For any
       * duration whose hour value repeats, that bias is systematic and the
       * parts stopped adding up to the whole. Accumulated raw now, and rounded
       * once where it is read — matching `productive`, which was always
       * accumulated unrounded. */

      productive += dayProductive;
      overlap += dayOverlap;

      // Approved leave removes the day from capacity entirely, so the
      // percentage is not punished for a day nobody expected work on.
      if (!windows.isWorkingDay || leave) {
        days.push({
          date,
          isWorkingDay: false,
          nonWorkingReason: leave ? "LEAVE" : windows.nonWorkingReason,
          capacityHours: 0,
          productiveHours: round(dayProductive),
          unutilizedHours: 0,
          hasData: dayLogs.length > 0,
        });
        continue;
      }

      if (!employed) {
        // Past their last day: no capacity, no expectation, no "missing data".
        days.push({
          date,
          isWorkingDay: false,
          // Not "they were idle" and not "it was a holiday" — they had left.
          // Distinguished so a day view can say so rather than implying either.
          nonWorkingReason: "NOT_EMPLOYED",
          capacityHours: 0,
          productiveHours: round(dayProductive),
          unutilizedHours: 0,
          hasData: dayLogs.length > 0,
        });
        continue;
      }

      expectedDays += 1;
      const dayCapacity = dayCapacityHours(config, breakMin, date);
      capacity += dayCapacity;

      /* Opening and closing compliance is gone.
       *
       * It counted days carrying an activity of type DAILY_OPENING or
       * DAILY_CLOSING — two codes out of the sixteen. The measure was "did they
       * file the two routine entries", which cannot be asked without a list of
       * entry kinds to ask it about. */

      const hasData = dayLogs.length > 0;
      // The distinction that keeps analytics honest: a day with no records is
      // MISSING_DATA. Counting it as unutilised would assert the instructor
      // did nothing, which the data does not support.
      const dayUnutilized = hasData ? Math.max(0, dayCapacity - dayProductive) : null;

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
      });
    }

    // ── Deliverable completion ───────────────────────────────────────────
    const mine = deliverables.filter((d) => d.instructorId === inst.id);
    const deliverableProgress = summariseDeliverables(mine, from, to);

    return {
      instructorId: inst.id,
      instructorName: inst.user.name,
      isActive: inst.user.isActive,
      employeeCode: inst.employeeCode,
      capacityHours: round(capacity),
      productiveHours: round(productive),
      unutilizedHours: round(unutilized),
      missingDataHours: round(missing),
      recordedHoursPct: capacity > 0 ? round((productive / capacity) * 100) : null,
      overlapHours: round(overlap),
      expectedWorkingDays: expectedDays,
      deliverables: deliverableProgress,
      days,
    };
  });

  const sum = (pick: (b: InstructorBreakdown) => number) =>
    round(breakdowns.reduce((acc, b) => acc + pick(b), 0));

  const totalCapacity = sum((b) => b.capacityHours);
  const totalProductive = sum((b) => b.productiveHours);
  /* `totalOpenings`, `totalClosings` and `totalsByType` are gone with the
     taxonomy. The first two counted days carrying a DAILY_OPENING or
     DAILY_CLOSING entry; the third summed hours per activity type. */

  let trend: TrendComparison | undefined;
  if (query.includeTrend) {
    const prev = previousPeriod(from, to);
    /* EVERY narrowing is carried through, so the trend compares like with like.
     *
     * `instructorId` was carried and `managerId` was not. The comment here used
     * to explain the first and was silent about the second, which is exactly
     * how it went unnoticed: this block predates rosters, and the roster work
     * added `managerId` to the instructor query and the deliverable query
     * without reaching the recursion.
     *
     * The effect was not a small skew. A manager with four of Northfield's
     * forty instructors saw their four people's current week compared against
     * the whole university's previous week — roughly a tenfold "collapse" in
     * teaching hours, reported as a real trend with a direction arrow on it.
     *
     * `includeInactive` is carried for the same reason: comparing a period that
     * includes former staff against one that excludes them invents a drop on
     * the day somebody leaves. Nothing sets it together with `includeTrend`
     * today, so that half is a latent hazard rather than a live fault — but it
     * is the same mistake and is fixed at the same time.
     *
     * Spread by PRESENCE, not truthiness: the engine narrows on
     * `"managerId" in query`, and `{ managerId: undefined }` is a different
     * question from no key at all — see the instructor query above. */
    const previousResult = await computeAnalytics({
      universityId,
      from: prev.from,
      to: prev.to,
      instructorId: query.instructorId,
      ...("managerId" in query ? { managerId: query.managerId } : {}),
      ...("includeInactive" in query ? { includeInactive: query.includeInactive } : {}),
    });

    trend = {
      previousFrom: prev.from,
      previousTo: prev.to,
      productiveHours: trendPoint(totalProductive, previousResult.totals.productiveHours),
      recordedHoursPct: trendPoint(
        totalCapacity > 0 ? round((totalProductive / totalCapacity) * 100) : null,
        previousResult.totals.recordedHoursPct,
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
      recordedHoursPct: totalCapacity > 0 ? round((totalProductive / totalCapacity) * 100) : null,
      deliverables: summariseDeliverables(deliverables, from, to),
    },
    instructors: breakdowns,
  };
}
