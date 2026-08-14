import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { generateWeeklyInsights } from "@/server/ai/insights";
import { logAudit } from "@/server/audit/logger";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";

/**
 * Insights are a management artifact, so the role gate lives in withAuth rather
 * than as an inline `principal.role` check — an admin must not be locked out of
 * a university-scoped view they have global rights to.
 */
export const GET = withAuth<{ id: string }>(
  async ({ params, scope }) => {
    assertCanAccessUniversity(scope, params.id);

    const insights = await prisma.aiInsight.findMany({
      where: { universityId: params.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ insights });
  },
  { roles: ["ADMIN", "MANAGER"] },
);

export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    assertCanAccessUniversity(scope, params.id);

    const config = await loadUniversityConfig(params.id);
    const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);

    const created = await generateWeeklyInsights(params.id, period.from, period.to);

    await logAudit(principal, scope, {
      action: "INSIGHT_GENERATED",
      universityId: params.id,
      metadata: { count: created.length, from: period.from, to: period.to },
    });

    return NextResponse.json({ insights: created }, { status: 201 });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
