/**
 * Manager-level performance, aggregated from the instructors who report to them.
 *
 * ── Why this exists rather than one engine call per manager ────────────────
 * The obvious implementation — ask the analytics engine for each manager's
 * roster in turn — is O(managers), and the admin list spans every university,
 * so the page paid universities × managers engine calls. Instead the engine is
 * asked ONCE PER UNIVERSITY (it already returns a per-instructor breakdown),
 * and the instructors are grouped by their manager here. Cost is O(universities)
 * no matter how many managers there are.
 *
 * ── The two hour figures, and why they are both from ActivityLog ───────────
 * `deliverableHours` here is NOT `DeliverableLog.hoursSpent`. That field is a
 * self-reported booking against a named piece of work, measured differently
 * from engine time, and the two are deliberately never mixed. Both figures
 * below come from the SAME source — the engine's `hoursByActivityType`, which
 * is computed from `ActivityLog` durations — so:
 *
 *     deliverableHours    = hours logged against the DELIVERABLE activity type
 *     nonDeliverableHours = hours logged against every other activity type
 *
 * They are symmetric, never negative, and sum to the instructor's total logged
 * time. One caveat worth knowing: those are RAW durations, while the engine's
 * `productiveHours` merges overlapping activities, so on a timesheet with
 * overlaps the two can exceed `productiveHours`. That is why utilisation below
 * keeps using the engine's own productive/capacity figures rather than being
 * re-derived from these columns.
 */

import { computeAnalytics } from "@/server/analytics/engine";
import { workingHoursByInstructor } from "@/server/analytics/hours-by-instructor";
import { addDays, mondayOf } from "@/server/analytics/tracker";
import { loadUniversityConfig } from "@/server/universities/config";
import { workDateFor } from "@/server/time/workday";
import { bandFor, type PerformanceBand } from "@/server/analytics/bands";


// The bands live in a dependency-free module so the client can share them.
export { UTILIZATION_BANDS, bandFor, type PerformanceBand } from "@/server/analytics/bands";

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Per-instructor figures, carrying the roster they belong to. */
export type InstructorPerformance = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  isActive: boolean;
  universityId: string;
  universityName: string;
  managerId: string | null;
  managerName: string | null;
  /** Time with students. See `hours-by-instructor.ts`. */
  workingHours: number;
  /** Every recorded minute. A different question, under its own name. */
  recordedHours: number;
  capacityHours: number;
  utilizationPct: number | null;
  band: PerformanceBand;
  /**
   * Deliverable progress for the same period, straight from the engine.
   *
   * Carried here rather than fetched separately because `computeAnalytics`
   * already computes it on the very row this is built from — surfacing it costs
   * nothing, and a second query for the same numbers could disagree with these.
   */
  deliverables: {
    total: number;
    completed: number;
    overdue: number;
    targetQuantity: number;
    completedQuantity: number;
    completionPct: number | null;
  };
};

export type RosterTotals = {
  instructorCount: number;
  workingHours: number;
  recordedHours: number;
  capacityHours: number;
  utilizationPct: number | null;
};

const EMPTY: RosterTotals = {
  instructorCount: 0,
  workingHours: 0,
  recordedHours: 0,
  capacityHours: 0,
  utilizationPct: null,
};


export type PeriodBounds = { from: string; to: string };

/**
 * The current reporting week for a university, in ITS timezone — a Kolkata
 * tenant rolls into a new week before a UTC server does.
 */
export async function currentWeekFor(universityId: string): Promise<PeriodBounds> {
  const config = await loadUniversityConfig(universityId);
  const today = workDateFor(new Date(), config.timezone);
  const from = mondayOf(today);
  // The WHOLE ISO week, Monday through Sunday. This previously returned
  // `{ from, to: from }` — Monday alone — while every caller and this
  // function's own name treated the result as a week. `computeAnalytics`
  // takes `from`/`to` as inclusive bounds, so a one-day window silently
  // reported one day's hours as the week's, and `previousWeek` compared
  // Monday against the previous Monday. Both figures were real; neither was
  // the week it claimed to be.
  return { from, to: addDays(from, 6) };
}

/** Shifts a week bound back by seven days, for the previous-period comparison. */
export function previousWeek(period: PeriodBounds): PeriodBounds {
  const shift = (iso: string) => {
    const d = new Date(`${iso}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(period.from), to: shift(period.to) };
}

/**
 * Every instructor's performance across the given universities, for one period.
 *
 * ONE engine call per university. The caller groups the result however it needs
 * — by manager for the managers list, or flat for the instructor problem list.
 */
export async function instructorPerformance(args: {
  universities: Array<{ id: string; name: string }>;
  /** Instructor id → the manager who leads them, and that manager's name. */
  managerOf: Map<string, { id: string; name: string }>;
  /** Resolved per university, since "this week" is timezone-dependent. */
  periodFor: Map<string, PeriodBounds>;
}): Promise<InstructorPerformance[]> {
  const { universities, managerOf, periodFor } = args;

  const perUniversity = await Promise.all(
    universities.map(async (u) => {
      const period = periodFor.get(u.id);
      if (!period) return [];
      const [analytics, studentFacing] = await Promise.all([
        computeAnalytics({ universityId: u.id, from: period.from, to: period.to }),
        workingHoursByInstructor({ universityId: u.id, from: period.from, to: period.to }),
      ]);
      return analytics.instructors.map((i): InstructorPerformance => {
        const manager = managerOf.get(i.instructorId) ?? null;
        return {
          instructorId: i.instructorId,
          instructorName: i.instructorName,
          employeeCode: i.employeeCode,
          isActive: i.isActive,
          universityId: u.id,
          universityName: u.name,
          managerId: manager?.id ?? null,
          managerName: manager?.name ?? null,
          /* The student-facing figure, read from the entries — NOT the
           * engine's `productiveHours`, which is every recorded minute and was
           * published under this name until now. `deliverableHours` and
           * `nonDeliverableHours` are gone with it: the first was hours whose
           * CATEGORY happened to be "Deliverable Work" and the second was
           * everything else, so a lecture counted as "non-deliverable" — a name
           * that said the opposite of what it measured. */
          workingHours: studentFacing.get(i.instructorId) ?? 0,
          /** Every recorded minute. Kept because `missing` and `unutilized`
           *  are derived against it, and it is honest under its own name. */
          recordedHours: i.productiveHours,
          capacityHours: i.capacityHours,
          utilizationPct: i.utilizationPct,
          band: bandFor(i.utilizationPct),
          deliverables: {
            total: i.deliverables.total,
            completed: i.deliverables.completed,
            overdue: i.deliverables.overdue,
            targetQuantity: i.deliverables.targetQuantity,
            completedQuantity: i.deliverables.completedQuantity,
            completionPct: i.deliverables.completionPct,
          },
        };
      });
    }),
  );

  return perUniversity.flat();
}

/** Folds a set of instructors into one roster's totals. */
export function rosterTotals(rows: InstructorPerformance[]): RosterTotals {
  if (rows.length === 0) return { ...EMPTY };

  let workingHours = 0;
  let recordedHours = 0;
  let capacityHours = 0;

  for (const r of rows) {
    workingHours += r.workingHours;
    recordedHours += r.recordedHours;
    capacityHours += r.capacityHours;
  }

  return {
    instructorCount: rows.length,
    workingHours: round(workingHours),
    recordedHours: round(recordedHours),
    capacityHours: round(capacityHours),
    // Recomputed from the totals, never averaged from per-instructor
    // percentages: averaging a percentage over people with different capacities
    // is a different, wrong number.
    //
    // Over RECORDED hours, not Working Hours. Utilisation asks how much of the
    // configured day was accounted for, and preparation and meetings account
    // for it just as much as a lecture does. Dividing student-facing hours by
    // capacity would answer neither question and read like both.
    utilizationPct: capacityHours > 0 ? Math.round((recordedHours / capacityHours) * 100) : null,
  };
}
