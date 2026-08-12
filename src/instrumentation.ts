/**
 * Next.js runs `register()` once when the server process starts. This is where
 * the metric rollup scheduler is attached, so summary tables stay current
 * without anyone triggering them by hand.
 *
 * Guarded to the Node.js runtime: the edge runtime has no timers of this kind
 * and no database connection.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMetricsScheduler } = await import("@/server/jobs/metrics-scheduler");
  startMetricsScheduler();
}
