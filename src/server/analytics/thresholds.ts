/**
 * The numbers the product already owns, so the assistant states them rather
 * than inventing its own.
 *
 * ── Why these outlived the anomaly detector they lived in ─────────────────
 * They were declared inside `ai/anomalies.ts`, beside a function that walked an
 * analytics result and graded each instructor — HIGH, MEDIUM, LOW — into
 * conditions that became notifications and stored insights about named people.
 * That scorer is deleted; these constants are not part of it.
 *
 * A threshold is not a judgement. "Compliance is measured at 90%" is a fact
 * about how the product is configured, and the AI assistant needs it so its
 * prose agrees with the figures on screen instead of choosing a round number of
 * its own. What was removed is the code that took these numbers and decided
 * somebody was failing to meet them.
 */
export const THRESHOLDS = {
  overloadUtilizationPct: 100,
  underutilizedUtilizationPct: 60,
  compliancePct: 90,
  deliverableCompletionPct: 60,
  significantMissingDataHours: 1,
} as const;
