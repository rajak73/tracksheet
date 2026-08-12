import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { runRollup } from "@/server/jobs/metrics-scheduler";
import { resolvePeriod } from "@/server/analytics/period";
import { logAudit } from "@/server/audit/logger";
import { prisma } from "@/server/db";

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

    // Same function the scheduler calls, so a manual recompute and an
    // automatic one cannot produce different numbers.
    const result = await runRollup("MANUAL", { from: period.from, to: period.to });

    if (!result) {
      return NextResponse.json(
        { error: { code: "ROLLUP_IN_PROGRESS", message: "A rollup is already running" } },
        { status: 409 },
      );
    }

    await logAudit(principal, scope, {
      action: "METRICS_ROLLUP_RUN",
      metadata: {
        from: period.from,
        to: period.to,
        runId: result.id,
        instructorDays: result.instructorDays,
        instructorWeeks: result.instructorWeeks,
      },
    });

    return NextResponse.json({
      runId: result.id,
      from: period.from,
      to: period.to,
      instructorDays: result.instructorDays,
      instructorWeeks: result.instructorWeeks,
    });
  },
  { roles: ["ADMIN"] },
);


/**
 * Rollup history — answers "are the dashboards current, and did the last run
 * actually succeed?" without reading server logs.
 */
export const GET = withAuth(
  async () => {
    const runs = await prisma.metricsJobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
    });

    const lastCompleted = runs.find((r) => r.status === "COMPLETED");

    return NextResponse.json({
      lastCompletedAt: lastCompleted?.completedAt ?? null,
      lastCompletedTrigger: lastCompleted?.trigger ?? null,
      staleSeconds: lastCompleted?.completedAt
        ? Math.floor((Date.now() - lastCompleted.completedAt.getTime()) / 1000)
        : null,
      runs,
    });
  },
  { roles: ["ADMIN"] },
);
