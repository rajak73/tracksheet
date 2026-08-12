/**
 * Insight generation: detect deterministically, then narrate.
 *
 *   analytics (calculated metrics)
 *        -> detectAnomalies()   plain code, decides WHETHER a condition holds
 *        -> narrateCondition()  turns one condition into a sentence
 *        -> stored insight      carrying the condition and its metrics
 *
 * The narration layer receives an AnomalyCondition and nothing else, so no code
 * path can hand raw activity rows to a model — the input type cannot carry one.
 *
 * Every stored insight records the condition type, the metric values compared,
 * and the threshold applied, so any claim can be checked against the numbers it
 * came from rather than taken on trust.
 */

import { prisma } from "@/server/db";
import { InsightSeverity, InsightStatus } from "@/generated/prisma/client";
import { createNotification } from "@/server/notifications/service";
import { computeAnalytics, type AnalyticsResult } from "@/server/analytics/engine";
import { detectAnomalies, type AnomalyCondition } from "@/server/ai/anomalies";
import { narrateCondition } from "@/server/ai/narrate";
import { toDateOnly } from "@/server/time/workday";

export type DraftInsight = {
  type: string;
  severity: InsightSeverity;
  period: string;
  title: string;
  summary: string;
  recommendation: string;
  /** The condition that triggered this, with the numbers and threshold used. */
  condition: AnomalyCondition;
  supportingData: Record<string, unknown>;
};

const SEVERITY: Record<AnomalyCondition["severity"], InsightSeverity> = {
  LOW: InsightSeverity.LOW,
  MEDIUM: InsightSeverity.MEDIUM,
  HIGH: InsightSeverity.HIGH,
};

/**
 * Pure: metrics in, insights out. Exported so the rules can be reviewed and
 * tested against a known snapshot without a database.
 */
export async function deriveInsights(analytics: AnalyticsResult): Promise<DraftInsight[]> {
  const period = `${analytics.from} to ${analytics.to}`;

  const conditions = detectAnomalies(analytics);

  // Sequential rather than parallel: a burst of concurrent calls is the
  // fastest way to hit the provider's rate limit, and insight generation is
  // not latency-critical.
  const drafts: DraftInsight[] = [];
  for (const condition of conditions) {
    const narration = await narrateCondition(condition);
    drafts.push({
      type: condition.type,
      severity: SEVERITY[condition.severity],
      period,
      title: narration.title,
      summary: narration.summary,
      recommendation: narration.recommendation,
      condition,
      // The snapshot is exactly what the sentence was derived from.
      supportingData: {
        conditionType: condition.type,
        scope: condition.scope,
        instructorId: condition.instructorId ?? null,
        metrics: condition.metrics,
        threshold: condition.threshold,
      },
    });
  }

  return drafts;
}

export async function generateWeeklyInsights(universityId: string, from: string, to: string) {
  // includeTrend so LEARNING_DROP has a comparison period; without it that
  // condition could never fire and the rule would be dead code.
  const analytics = await computeAnalytics({ universityId, from, to, includeTrend: true });
  const drafts = await deriveInsights(analytics);

  if (drafts.length === 0) return [];

  const created = await Promise.all(
    drafts.map((insight) =>
      prisma.aiInsight.create({
        data: {
          scope: "UNIVERSITY",
          universityId,
          type: insight.type,
          severity: insight.severity,
          title: insight.title,
          summary: insight.summary,
          recommendation: insight.recommendation,
          period: insight.period,
          periodStart: toDateOnly(from),
          periodEnd: toDateOnly(to),
          // The snapshot is exactly what the sentence was derived from, so any
          // claim can be checked against it after the fact.
          sourceMetrics: insight.supportingData as object,
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
