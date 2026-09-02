/**
 * The data an AI insight is allowed to see, decided by the server.
 *
 * ── The one rule this file exists to enforce ───────────────────────────────
 * The model never chooses its own scope. Every context below is built FROM the
 * caller's `TenantScope`, so an admin's context contains their tenant, a
 * manager's contains their roster and nothing else, and an instructor's
 * contains one person. There is no parameter a client can send that widens any
 * of them — a manager cannot ask for a colleague's roster because the roster is
 * read from the session, not from the request.
 *
 * ── Metrics are computed here, never by the model ──────────────────────────
 * Every number handed to Gemini has already been produced by the existing
 * analytics engine and roster aggregation. The model is asked to explain and
 * recommend; it is never asked to count. That is what keeps a plausible
 * sentence from becoming an authoritative figure.
 *
 * ── Only what the insight needs ────────────────────────────────────────────
 * Emails, employee codes, activity remarks and anything else not required to
 * explain a number are deliberately excluded. Names are included because an
 * insight that cannot say who it is about is not actionable, and the reader is
 * already authorised to see the people in their own scope.
 */

import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import type { TenantScope } from "@/server/auth/scope";
import {
  bandFor,
  currentWeekFor,
  instructorPerformance,
  previousWeek,
  rosterTotals,
  type PeriodBounds,
} from "@/server/analytics/roster";
import { UTILIZATION_BANDS, type PerformanceBand } from "@/server/analytics/bands";
import { THRESHOLDS } from "@/server/analytics/thresholds";

export type InsightAudience = "ADMIN" | "MANAGER" | "INSTRUCTOR";

type DeliverableFacts = {
  total: number;
  completed: number;
  overdue: number;
  completionPct: number | null;
};

type ManagerFacts = {
  id: string;
  name: string;
  universityId: string;
  universityName: string;
  instructorCount: number;
  workingHours: number;
  recordedHours: number;
  utilization: number | null;
  trend: number | null;
  band: PerformanceBand;
  deliverables: DeliverableFacts;
};

type PersonFacts = {
  id: string;
  name: string;
  workingHours: number;
  recordedHours: number;
  utilization: number | null;
  trend: number | null;
  band: PerformanceBand;
  deliverables: DeliverableFacts;
};

/**
 * The business rules the model is told as fact.
 *
 * Sent so a recommendation can SAY where a threshold sits without the model ever
 * being asked to choose one. Both values are the platform's own — the utilisation
 * bands the dashboards colour by, and the deliverable-completion threshold the
 * existing anomaly rules already fire on — imported rather than restated, so
 * there is one definition of "needs attention" in the product.
 */
export type ThresholdFacts = {
  bands: { healthy: number; borderline: number };
  deliverableCompletionPct: number;
};

const THRESHOLD_FACTS: ThresholdFacts = {
  bands: { healthy: UTILIZATION_BANDS.healthy, borderline: UTILIZATION_BANDS.borderline },
  deliverableCompletionPct: THRESHOLDS.deliverableCompletionPct,
};

export type InsightContext =
  | {
      audience: "ADMIN";
      period: PeriodBounds;
      thresholds: ThresholdFacts;
      managers: ManagerFacts[];
      instructorSummary: { total: number; needingAttention: number; unassigned: number };
      worstInstructors: PersonFacts[];
    }
  | {
      audience: "MANAGER";
      period: PeriodBounds;
      thresholds: ThresholdFacts;
      managerName: string;
      roster: PersonFacts[];
      totals: {
        instructorCount: number;
        workingHours: number;
        recordedHours: number;
        utilization: number | null;
        deliverables: DeliverableFacts;
      };
    }
  | {
      audience: "INSTRUCTOR";
      period: PeriodBounds;
      thresholds: ThresholdFacts;
      /** Their own id, so a recommendation can reference the person it is about. */
      instructorId: string;
      name: string;
      metrics: {
        workingHours: number;
        recordedHours: number;
        utilization: number | null;
        trend: number | null;
        band: PerformanceBand;
        deliverables: DeliverableFacts;
      };
    };

/** How many low performers an insight is given. Bounded to keep prompts small. */
const WORST_LIMIT = 5;

/**
 * Folds deliverable progress over a set of instructors.
 *
 * `completionPct` is recomputed from the summed quantities, never averaged from
 * the per-person percentages: averaging a percentage across people with
 * different targets is a different, wrong number — the same reason
 * `rosterTotals` recomputes utilisation from the hour totals.
 */
function foldDeliverables(
  rows: Array<{ deliverables: { total: number; completed: number; overdue: number; targetQuantity: number; completedQuantity: number } }>,
): DeliverableFacts {
  let total = 0, completed = 0, overdue = 0, target = 0, done = 0;
  for (const r of rows) {
    total += r.deliverables.total;
    completed += r.deliverables.completed;
    overdue += r.deliverables.overdue;
    target += r.deliverables.targetQuantity;
    done += r.deliverables.completedQuantity;
  }
  return {
    total,
    completed,
    overdue,
    completionPct: target > 0 ? Math.round((done / target) * 10000) / 100 : null,
  };
}

function trendOf(now: number | null, before: number | null): number | null {
  // Null rather than zero when there is nothing to compare against: "no prior
  // data" and "unchanged" are different facts, and the model must not conflate
  // them into "flat".
  return now === null || before === null ? null : now - before;
}

/**
 * Builds the context for whoever is asking, from their scope alone.
 *
 * One analytics pass per university per period — the same aggregation the
 * dashboards use — so an insight costs the same whether a manager leads two
 * people or fifty. There is no per-person analytics call anywhere here.
 */
export async function buildInsightContext(scope: TenantScope): Promise<InsightContext> {
  if (scope.kind === "self") return instructorContext(scope);
  if (scope.kind === "university") return managerContext(scope);
  return adminContext();
}

async function adminContext(): Promise<InsightContext> {
  const managers = await prisma.manager.findMany({
    where: { user: { isActive: true } },
    select: {
      id: true,
      universityId: true,
      user: { select: { name: true } },
      university: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (managers.length === 0) {
    throw new ApiError(422, "NO_DATA", "There are no managers to report on yet");
  }

  const universities = [
    ...new Map(managers.map((m) => [m.universityId, m.university])).values(),
  ].map((u) => ({ id: u.id, name: u.name }));

  const instructors = await prisma.instructor.findMany({
    where: { user: { isActive: true } },
    select: { id: true, managerId: true },
  });
  const nameOf = new Map(managers.map((m) => [m.id, m.user.name]));
  const managerOf = new Map(
    instructors
      .filter((i) => i.managerId)
      .map((i) => [i.id, { id: i.managerId!, name: nameOf.get(i.managerId!) ?? "" }]),
  );

  const periodFor = new Map<string, PeriodBounds>();
  await Promise.all(universities.map(async (u) => periodFor.set(u.id, await currentWeekFor(u.id))));
  const previousFor = new Map([...periodFor].map(([id, p]) => [id, previousWeek(p)]));

  const [now, before] = await Promise.all([
    instructorPerformance({ universities, managerOf, periodFor }),
    instructorPerformance({ universities, managerOf, periodFor: previousFor }),
  ]);

  const group = (rows: typeof now) => {
    const out = new Map<string, typeof now>();
    for (const r of rows) {
      if (!r.managerId) continue;
      const bucket = out.get(r.managerId);
      if (bucket) bucket.push(r);
      else out.set(r.managerId, [r]);
    }
    return out;
  };
  const byManager = group(now);
  const beforeByManager = group(before);

  const managerFacts: ManagerFacts[] = managers.map((m) => {
    const totals = rosterTotals(byManager.get(m.id) ?? []);
    const prior = rosterTotals(beforeByManager.get(m.id) ?? []);
    const rows = byManager.get(m.id) ?? [];
    return {
      id: m.id,
      name: m.user.name,
      universityId: m.university.id,
      universityName: m.university.name,
      instructorCount: totals.instructorCount,
      workingHours: totals.workingHours,
      recordedHours: totals.recordedHours,
      utilization: totals.recordedHoursPct,
      trend: trendOf(totals.recordedHoursPct, prior.recordedHoursPct),
      band: bandFor(totals.recordedHoursPct),
      deliverables: foldDeliverables(rows),
    };
  });

  const beforeById = new Map(before.map((r) => [r.instructorId, r]));
  const worst = [...now]
    .filter((i) => i.band === "attention")
    .sort((a, b) => (a.recordedHoursPct ?? 999) - (b.recordedHoursPct ?? 999))
    .slice(0, WORST_LIMIT)
    .map((i): PersonFacts => ({
      id: i.instructorId,
      name: i.instructorName,
      workingHours: i.workingHours,
      recordedHours: i.recordedHours,
      utilization: i.recordedHoursPct,
      trend: trendOf(i.recordedHoursPct, beforeById.get(i.instructorId)?.recordedHoursPct ?? null),
      band: i.band,
      deliverables: foldDeliverables([i]),
    }));

  /* The widest window the facts actually span.
   *
   * This took `periodFor.get(universities[0])` — the week of whichever
   * university the oldest manager happened to belong to. `periodFor` is
   * resolved PER university precisely because "this week" is timezone
   * dependent: with tenants in Asia/Kolkata and America/Los_Angeles, on a
   * Sunday evening UTC one has rolled into the new ISO week and the other has
   * not, so the ranges sit seven days apart. Stamping one of them on a fact set
   * built from both made the brief, the "written from your figures for …"
   * label, and the persisted periodStart/periodEnd all state a week that half
   * the numbers are not from — and `allowedDates` then admitted only that week,
   * so the model could not cite the other one truthfully either.
   *
   * The envelope is honest: every fact in here falls inside it. */
  const spans = universities.map((u) => periodFor.get(u.id)!).filter(Boolean);
  const period = {
    from: spans.reduce((a, p) => (p.from < a ? p.from : a), spans[0]!.from),
    to: spans.reduce((a, p) => (p.to > a ? p.to : a), spans[0]!.to),
  };

  return {
    audience: "ADMIN",
    period,
    thresholds: THRESHOLD_FACTS,
    managers: managerFacts,
    instructorSummary: {
      total: instructors.length,
      needingAttention: now.filter((i) => i.band === "attention").length,
      unassigned: instructors.filter((i) => !i.managerId).length,
    },
    worstInstructors: worst,
  };
}

async function managerContext(
  scope: Extract<TenantScope, { kind: "university" }>,
): Promise<InsightContext> {
  if (!scope.managerId) {
    throw new ApiError(403, "FORBIDDEN", "Manager profile is incomplete");
  }

  const manager = await prisma.manager.findUnique({
    where: { id: scope.managerId },
    select: { id: true, user: { select: { name: true } }, university: { select: { id: true, name: true } } },
  });
  if (!manager) throw new ApiError(404, "NOT_FOUND", "Manager not found");

  // The roster is read from the database using the SESSION's manager id. A
  // request cannot name a different one.
  const roster = await prisma.instructor.findMany({
    where: { managerId: scope.managerId, user: { isActive: true } },
    select: { id: true },
  });
  const managerOf = new Map(
    roster.map((i) => [i.id, { id: manager.id, name: manager.user.name }]),
  );

  const universities = [{ id: manager.university.id, name: manager.university.name }];
  const period = await currentWeekFor(manager.university.id);
  const periodFor = new Map([[manager.university.id, period]]);
  const previousFor = new Map([[manager.university.id, previousWeek(period)]]);

  const [now, before] = await Promise.all([
    instructorPerformance({ universities, managerOf, periodFor }),
    instructorPerformance({ universities, managerOf, periodFor: previousFor }),
  ]);

  const mine = now.filter((i) => i.managerId === manager.id);
  const beforeById = new Map(before.map((r) => [r.instructorId, r]));
  const totals = rosterTotals(mine);

  return {
    audience: "MANAGER",
    period,
    thresholds: THRESHOLD_FACTS,
    managerName: manager.user.name,
    roster: mine
      .sort((a, b) => (a.recordedHoursPct ?? 999) - (b.recordedHoursPct ?? 999))
      .map((i): PersonFacts => ({
        id: i.instructorId,
        name: i.instructorName,
        workingHours: i.workingHours,
        recordedHours: i.recordedHours,
        utilization: i.recordedHoursPct,
        trend: trendOf(i.recordedHoursPct, beforeById.get(i.instructorId)?.recordedHoursPct ?? null),
        band: i.band,
        deliverables: foldDeliverables([i]),
      })),
    totals: {
      instructorCount: totals.instructorCount,
      workingHours: totals.workingHours,
      recordedHours: totals.recordedHours,
      utilization: totals.recordedHoursPct,
      deliverables: foldDeliverables(mine),
    },
  };
}

async function instructorContext(
  scope: Extract<TenantScope, { kind: "self" }>,
): Promise<InsightContext> {
  const me = await prisma.instructor.findUnique({
    where: { id: scope.instructorId },
    select: {
      id: true,
      managerId: true,
      user: { select: { name: true } },
      university: { select: { id: true, name: true } },
    },
  });
  if (!me) throw new ApiError(404, "NOT_FOUND", "Instructor not found");

  const universities = [{ id: me.university.id, name: me.university.name }];
  const period = await currentWeekFor(me.university.id);
  const periodFor = new Map([[me.university.id, period]]);
  const previousFor = new Map([[me.university.id, previousWeek(period)]]);
  const managerOf = new Map<string, { id: string; name: string }>();

  const [now, before] = await Promise.all([
    instructorPerformance({ universities, managerOf, periodFor }),
    instructorPerformance({ universities, managerOf, periodFor: previousFor }),
  ]);

  // The analytics pass covers the university; only THIS person's row is kept.
  // Nothing about a colleague reaches the prompt.
  const mine = now.find((i) => i.instructorId === scope.instructorId);
  const prior = before.find((i) => i.instructorId === scope.instructorId);
  if (!mine) {
    throw new ApiError(422, "NO_DATA", "There is nothing recorded for you in this period yet");
  }

  // Hours per activity type come from the engine, narrowed to this one person.
  // One call, and the same numbers their own performance page renders — an
  /* The second analytics pass is gone with the breakdown it fed. It computed
     this instructor's hours split by activity type, purely so the assistant
     could name where their time went — a query paid for on every brief, for a
     field that no longer exists. */

  return {
    audience: "INSTRUCTOR",
    period,
    thresholds: THRESHOLD_FACTS,
    instructorId: me.id,
    name: me.user.name,
    metrics: {
      workingHours: mine.workingHours,
      recordedHours: mine.recordedHours,
      utilization: mine.recordedHoursPct,
      trend: trendOf(mine.recordedHoursPct, prior?.recordedHoursPct ?? null),
      band: mine.band,
      deliverables: foldDeliverables([mine]),
    },
    /* `activityBreakdown` is gone. It handed the assistant this person's hours
       split by activity type — a fixed list of sixteen — so its prose could name
       where the time went. There is no list to split by, and the assistant
       describes what the figures say instead. */
  };
}
