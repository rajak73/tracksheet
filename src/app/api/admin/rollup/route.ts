import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { rollupAllUniversities } from "@/server/analytics/rollup";
import { resolvePeriod } from "@/server/analytics/period";
import { logAudit } from "@/server/audit/logger";

/**
 * Triggers the daily metric rollup.
 *
 * This is the handover point for a scheduler: today it is invoked manually or
 * by cron hitting this endpoint; moving it to a BullMQ worker later means
 * calling `rollupAllUniversities` from the worker instead, with no change to
 * the logic. It is admin-only because it is a platform-wide operation.
 */
export const POST = withAuth(
  async ({ req, principal, scope }) => {
    // UTC for the period default: this is a platform-wide job, not a single
    // tenant's view, and each university's own days are resolved inside the
    // engine from its configured timezone.
    const period = resolvePeriod(req.nextUrl.searchParams, "UTC");

    const started = Date.now();
    const results = await rollupAllUniversities(period.from, period.to);
    const durationMs = Date.now() - started;

    await logAudit(principal, scope, {
      action: "METRICS_ROLLUP_RUN",
      metadata: {
        from: period.from,
        to: period.to,
        universities: results.length,
        instructorDays: results.reduce((a, r) => a + r.instructorDays, 0),
        durationMs,
      },
    });

    return NextResponse.json({
      from: period.from,
      to: period.to,
      universities: results.length,
      instructorDays: results.reduce((a, r) => a + r.instructorDays, 0),
      universityDays: results.reduce((a, r) => a + r.universityDays, 0),
      durationMs,
    });
  },
  { roles: ["ADMIN"] },
);
