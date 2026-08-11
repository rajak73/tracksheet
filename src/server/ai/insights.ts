/**
 * Insight generation on top of the deterministic analytics engine.
 *
 * The hard rule: every sentence produced here must be derivable from the metric
 * snapshot stored alongside it. Previously a WORKLOAD_BALANCE insight was
 * emitted unconditionally with literal figures ("2 instructors have recorded
 * 10+ hours of unutilized capacity") even when the university had zero activity
 * records — the stored "supporting data" was invented, which made the audit
 * trail actively misleading rather than merely absent.
 *
 * Now: each rule reads real metrics, emits only when its precondition holds,
 * and stores the exact numbers it quoted. If nothing is true, nothing is
 * generated — an empty list is a valid and honest result.
 *
 * Language is neutral by construction. Rules describe measurements and
 * recommend review; they never characterise a person.
 */

import { prisma } from "@/server/db";
import { InsightSeverity, InsightStatus } from "@/generated/prisma/client";
import { createNotification } from "@/server/notifications/service";
import { computeAnalytics, type AnalyticsResult } from "@/server/analytics/engine";

/** Thresholds live here as named constants so an insight is never a magic number. */
const UNDERUTILIZED_PCT = 60;
const OVERLOADED_PCT = 100;
const LOW_COMPLIANCE_PCT = 90;
const MISSING_DATA_SIGNIFICANT_HOURS = 1;

export type DraftInsight = {
  type: string;
  severity: InsightSeverity;
  period: string;
  recommendation: string;
  supportingData: Record<string, unknown>;
};

/**
 * Pure: metrics in, insights out. Exported so it can be tested directly against
 * a known snapshot, and so the rules can be reviewed without a database.
 */
export function deriveInsights(analytics: AnalyticsResult): DraftInsight[] {
  const period = `${analytics.from} to ${analytics.to}`;
  const t = analytics.totals;
  const out: DraftInsight[] = [];

  // No instructors: there is nothing to say, and saying anything would be
  // inventing a subject.
  if (t.instructors === 0) return out;

  const withCapacity = analytics.instructors.filter((i) => i.capacityHours > 0);

  // 1. No activity data recorded at all despite expected working time.
  if (t.capacityHours > 0 && t.productiveHours === 0) {
    out.push({
      type: "SYSTEM_ADOPTION",
      severity: InsightSeverity.HIGH,
      period,
      recommendation:
        `No activity was recorded against ${t.capacityHours} hours of available capacity ` +
        `for ${t.instructors} instructor(s) in this period. This most likely indicates the ` +
        `system is not yet in use rather than an absence of work; confirming logging practice ` +
        `is recommended before treating these figures as workload data.`,
      supportingData: {
        instructors: t.instructors,
        capacityHours: t.capacityHours,
        productiveHours: t.productiveHours,
        missingDataHours: t.missingDataHours,
      },
    });
  }

  // 2. Underutilisation — only named when actually measured.
  const under = withCapacity.filter(
    (i) => i.utilizationPct !== null && i.utilizationPct < UNDERUTILIZED_PCT,
  );
  if (under.length > 0 && t.productiveHours > 0) {
    out.push({
      type: "CAPACITY_AVAILABLE",
      severity: InsightSeverity.MEDIUM,
      period,
      recommendation:
        `${under.length} instructor(s) recorded utilisation below ${UNDERUTILIZED_PCT}% ` +
        `against configured capacity. This may indicate available capacity; a manager ` +
        `review of task assignment is recommended before drawing conclusions.`,
      supportingData: {
        threshold: UNDERUTILIZED_PCT,
        count: under.length,
        instructors: under.map((i) => ({
          instructorId: i.instructorId,
          utilizationPct: i.utilizationPct,
          capacityHours: i.capacityHours,
          productiveHours: i.productiveHours,
        })),
      },
    });
  }

  // 3. Potential overload.
  const over = withCapacity.filter(
    (i) => i.utilizationPct !== null && i.utilizationPct > OVERLOADED_PCT,
  );
  if (over.length > 0) {
    out.push({
      type: "WORKLOAD_IMBALANCE",
      severity: InsightSeverity.HIGH,
      period,
      recommendation:
        `${over.length} instructor(s) recorded productive time exceeding their configured ` +
        `capacity. Reviewing workload distribution is recommended.`,
      supportingData: {
        threshold: OVERLOADED_PCT,
        count: over.length,
        instructors: over.map((i) => ({
          instructorId: i.instructorId,
          utilizationPct: i.utilizationPct,
          capacityHours: i.capacityHours,
          productiveHours: i.productiveHours,
        })),
      },
    });
  }

  // 4. Opening/closing compliance.
  for (const [kind, pct] of [
    ["opening", t.openingCompliancePct],
    ["closing", t.closingCompliancePct],
  ] as const) {
    if (pct !== null && pct < LOW_COMPLIANCE_PCT) {
      out.push({
        type: kind === "opening" ? "OPENING_COMPLIANCE" : "CLOSING_COMPLIANCE",
        severity: pct < 50 ? InsightSeverity.HIGH : InsightSeverity.MEDIUM,
        period,
        recommendation:
          `Daily ${kind} was recorded on ${pct}% of expected working days, below the ` +
          `${LOW_COMPLIANCE_PCT}% reference level. Confirming whether this reflects ` +
          `process or logging is recommended.`,
        supportingData: { metric: `${kind}CompliancePct`, value: pct, threshold: LOW_COMPLIANCE_PCT },
      });
    }
  }

  // 5. Data completeness — flagged as a caveat on the numbers above, never as
  //    an accusation, because missing data is not evidence of missing work.
  if (t.missingDataHours >= MISSING_DATA_SIGNIFICANT_HOURS) {
    out.push({
      type: "DATA_COMPLETENESS",
      severity: InsightSeverity.LOW,
      period,
      recommendation:
        `${t.missingDataHours} hours of expected working time have no activity records. ` +
        `These hours are reported as missing data, not as unutilised time, and the ` +
        `utilisation figures above should be read with that in mind.`,
      supportingData: {
        missingDataHours: t.missingDataHours,
        capacityHours: t.capacityHours,
        unutilizedHours: t.unutilizedHours,
      },
    });
  }

  return out;
}

export async function generateWeeklyInsights(universityId: string, from: string, to: string) {
  const analytics = await computeAnalytics({ universityId, from, to });
  const drafts = deriveInsights(analytics);

  if (drafts.length === 0) return [];

  const created = await Promise.all(
    drafts.map((insight) =>
      prisma.aiInsight.create({
        data: {
          universityId,
          type: insight.type,
          severity: insight.severity,
          period: insight.period,
          recommendation: insight.recommendation,
          // The snapshot is exactly what the sentence was derived from, so any
          // claim can be checked against it after the fact.
          supportingData: insight.supportingData as object,
          status: InsightStatus.NEW,
        },
      }),
    ),
  );

  const university = await prisma.university.findUnique({
    where: { id: universityId },
    select: { primaryManager: { select: { userId: true } } },
  });

  if (university?.primaryManager?.userId) {
    await createNotification(
      university.primaryManager.userId,
      "New AI Insights Generated",
      `Generated ${created.length} new insight(s) for ${analytics.from} to ${analytics.to}.`,
    );
  }

  return created;
}
