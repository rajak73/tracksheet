/**
 * Utilisation bands — the one definition of "healthy", "borderline" and
 * "needs attention" in the product.
 *
 * ── Why this file has no imports ───────────────────────────────────────────
 * Both halves of the app need these numbers: the API decides a manager's band
 * server-side, and several client pages label and count by the same
 * thresholds. `roster.ts` cannot be the home for them because it reaches the
 * database, and importing it into a client component would drag Prisma into
 * the browser bundle. So the constants live here, in a module that imports
 * nothing and is therefore safe on either side.
 *
 * ── Why it matters that they live in ONE place ─────────────────────────────
 * These thresholds were previously written as bare `75` and `60` in a handful
 * of pages as well as in the API's response. Nothing enforced that they agreed,
 * so a change in one place would silently give the dashboard, the analytics
 * page and the managers list three different opinions about who is failing.
 * Anything that classifies performance imports from here.
 */

/**
 * Percentage of capacity that counts as healthy, and the floor below which a
 * roster needs attention. Chosen when the analytics page was first built and
 * unchanged since; this module is a relocation, not a new policy.
 */
export const UTILIZATION_BANDS = { healthy: 75, borderline: 60 } as const;

export type PerformanceBand = "healthy" | "borderline" | "attention" | "unmeasured";

/**
 * Classifies a utilisation percentage.
 *
 * `null` is "unmeasured", never "attention": an instructor with no working-hours
 * capacity in the period has an unknown utilisation, and reporting unknown as
 * failing would send managers chasing people who did nothing wrong.
 */
export function bandFor(utilizationPct: number | null): PerformanceBand {
  if (utilizationPct === null) return "unmeasured";
  if (utilizationPct >= UTILIZATION_BANDS.healthy) return "healthy";
  if (utilizationPct >= UTILIZATION_BANDS.borderline) return "borderline";
  return "attention";
}

/** Human labels, so the wording is consistent wherever a band is shown. */
export const BAND_LABEL: Record<PerformanceBand, string> = {
  healthy: "Healthy",
  borderline: "Borderline",
  attention: "Needs attention",
  unmeasured: "No data",
};
