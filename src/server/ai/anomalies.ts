/**
 * Deterministic anomaly detection — plain code, no model.
 *
 * This layer decides WHETHER a condition exists. The narration layer decides
 * how to say it. That split is the point: a model asked to spot anomalies in a
 * metric dump will confidently invent them, whereas a model asked to phrase an
 * already-detected condition can only get the wording wrong, and the wording is
 * checkable against the numbers carried alongside it.
 *
 * Every condition records the values and the threshold that produced it, so
 * "why was this raised?" is answerable from the stored record without rerunning
 * anything.
 */

import type { AnalyticsResult, InstructorBreakdown } from "@/server/analytics/engine";

export const CONDITION_TYPES = [
  "OVERLOAD",
  "UNDERUTILIZATION",
  "LEARNING_DROP",
  "COMPLIANCE_RISK",
  "DELIVERABLE_RISK",
  "NO_DATA_RECORDED",
  "INCOMPLETE_DATA",
] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number];
export type ConditionSeverity = "LOW" | "MEDIUM" | "HIGH";

export type AnomalyCondition = {
  type: ConditionType;
  severity: ConditionSeverity;
  scope: "UNIVERSITY" | "INSTRUCTOR";
  instructorId?: string;
  instructorName?: string;
  /** Exactly the values compared, and what they were compared against. */
  metrics: Record<string, number | string | null>;
  threshold: Record<string, number>;
};

/**
 * Thresholds are named constants rather than inline numbers so an insight can
 * quote the threshold it used and a reader can see the rule.
 */
export const THRESHOLDS = {
  overloadUtilizationPct: 100,
  underutilizedUtilizationPct: 60,
  learningDropPct: 40,
  compliancePct: 90,
  deliverableCompletionPct: 60,
  significantMissingDataHours: 1,
} as const;

export function detectAnomalies(analytics: AnalyticsResult): AnomalyCondition[] {
  const conditions: AnomalyCondition[] = [];
  const t = analytics.totals;

  if (t.instructors === 0) return conditions;

  // ── Nothing recorded at all ────────────────────────────────────────────
  // Checked first and exclusively: with no activity, every other ratio is
  // either zero or undefined, and reporting "underutilization" would assert
  // something the data cannot support.
  if (t.capacityHours > 0 && t.productiveHours === 0) {
    conditions.push({
      type: "NO_DATA_RECORDED",
      severity: "HIGH",
      scope: "UNIVERSITY",
      metrics: {
        instructors: t.instructors,
        capacityHours: t.capacityHours,
        productiveHours: t.productiveHours,
        missingDataHours: t.missingDataHours,
      },
      threshold: {},
    });
    return conditions;
  }

  const measurable = (i: InstructorBreakdown) => i.capacityHours > 0 && i.utilizationPct !== null;

  // ── OVERLOAD ───────────────────────────────────────────────────────────
  for (const i of analytics.instructors.filter(measurable)) {
    if (i.utilizationPct! > THRESHOLDS.overloadUtilizationPct) {
      conditions.push({
        type: "OVERLOAD",
        severity: "HIGH",
        scope: "INSTRUCTOR",
        instructorId: i.instructorId,
        instructorName: i.instructorName,
        metrics: {
          utilizationPct: i.utilizationPct,
          capacityHours: i.capacityHours,
          productiveHours: i.productiveHours,
        },
        threshold: { utilizationPct: THRESHOLDS.overloadUtilizationPct },
      });
    }
  }

  // ── UNDERUTILIZATION ───────────────────────────────────────────────────
  for (const i of analytics.instructors.filter(measurable)) {
    if (i.utilizationPct! < THRESHOLDS.underutilizedUtilizationPct) {
      conditions.push({
        type: "UNDERUTILIZATION",
        severity: "MEDIUM",
        scope: "INSTRUCTOR",
        instructorId: i.instructorId,
        instructorName: i.instructorName,
        metrics: {
          utilizationPct: i.utilizationPct,
          capacityHours: i.capacityHours,
          productiveHours: i.productiveHours,
          missingDataHours: i.missingDataHours,
        },
        threshold: { utilizationPct: THRESHOLDS.underutilizedUtilizationPct },
      });
    }
  }

  // ── LEARNING_DROP ──────────────────────────────────────────────────────
  // Requires a trend; without a comparison period there is no drop to detect,
  // and inferring one from a single period would be fabrication.
  const learning = analytics.trend?.hoursByActivityType?.LEARNING;
  if (learning && learning.previous !== null && learning.current !== null && learning.previous > 0) {
    const dropPct = Math.round(((learning.previous - learning.current) / learning.previous) * 100);
    if (dropPct >= THRESHOLDS.learningDropPct) {
      conditions.push({
        type: "LEARNING_DROP",
        severity: dropPct >= 75 ? "HIGH" : "MEDIUM",
        scope: "UNIVERSITY",
        metrics: {
          currentHours: learning.current,
          previousHours: learning.previous,
          dropPct,
          previousFrom: analytics.trend!.previousFrom,
          previousTo: analytics.trend!.previousTo,
        },
        threshold: { dropPct: THRESHOLDS.learningDropPct },
      });
    }
  }

  // ── COMPLIANCE_RISK ────────────────────────────────────────────────────
  for (const [kind, pct] of [
    ["opening", t.openingCompliancePct],
    ["closing", t.closingCompliancePct],
  ] as const) {
    if (pct !== null && pct < THRESHOLDS.compliancePct) {
      conditions.push({
        type: "COMPLIANCE_RISK",
        severity: pct < 50 ? "HIGH" : "MEDIUM",
        scope: "UNIVERSITY",
        metrics: { kind, compliancePct: pct },
        threshold: { compliancePct: THRESHOLDS.compliancePct },
      });
    }
  }

  // ── DELIVERABLE_RISK ───────────────────────────────────────────────────
  const d = t.deliverables;
  if (d.total > 0 && (d.overdue > 0 || (d.completionPct !== null && d.completionPct < THRESHOLDS.deliverableCompletionPct))) {
    conditions.push({
      type: "DELIVERABLE_RISK",
      severity: d.overdue > 0 ? "HIGH" : "MEDIUM",
      scope: "UNIVERSITY",
      metrics: {
        total: d.total,
        overdue: d.overdue,
        completedQuantity: d.completedQuantity,
        targetQuantity: d.targetQuantity,
        completionPct: d.completionPct,
      },
      threshold: { completionPct: THRESHOLDS.deliverableCompletionPct },
    });
  }

  // ── INCOMPLETE_DATA ────────────────────────────────────────────────────
  // A caveat on everything above, never an accusation: missing records are not
  // evidence of missing work.
  if (t.missingDataHours >= THRESHOLDS.significantMissingDataHours) {
    conditions.push({
      type: "INCOMPLETE_DATA",
      severity: "LOW",
      scope: "UNIVERSITY",
      metrics: {
        missingDataHours: t.missingDataHours,
        capacityHours: t.capacityHours,
        unutilizedHours: t.unutilizedHours,
      },
      threshold: { missingDataHours: THRESHOLDS.significantMissingDataHours },
    });
  }

  return conditions;
}
