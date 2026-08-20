import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity, narrowManager } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { generateWeeklyInsights } from "@/server/ai/insights";
import { logAudit } from "@/server/audit/logger";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";
import { BRIEF_TYPE } from "@/server/ai/brief-type";

/**
 * Insights are a management artifact, so the role gate lives in withAuth rather
 * than as an inline `principal.role` check — an admin must not be locked out of
 * a university-scoped view they have global rights to.
 */
export const GET = withAuth<{ id: string }>(
  async ({ params, scope }) => {
    assertCanAccessUniversity(scope, params.id);

    /* ── Insights about a PERSON follow that person's roster ────────────────
     * AiInsight rows are of two kinds. Some are about the university and carry
     * no `instructorId`; those are the point of this endpoint and every manager
     * in the tenant may read them. Others are anomalies about one instructor —
     * they name them and carry their id — and those are a report on an
     * individual's work, which is bounded by the roster like every other such
     * read.
     *
     * Without this a manager could read the observations written about a peer
     * manager's instructor here, having just been refused the very metrics
     * those observations summarise at GET /api/instructors/[id]/metrics. */
    const roster = narrowManager(scope, null);

    const insights = await prisma.aiInsight.findMany({
      // Assistant briefs live in this table but are written for ONE reader and
      // carry their roster in `sourceMetrics`. Returning them by university
      // would give every manager here a colleague's roster; they have their own
      // session-scoped endpoint. See @/server/ai/brief-type.
      where: {
        universityId: params.id,
        type: { not: BRIEF_TYPE },
        ...(roster.managerId !== undefined
          ? {
              OR: [
                // About the university itself, not about anybody in particular.
                { instructorId: null },
                { instructor: { managerId: roster.managerId } },
              ],
            }
          : {}),
      },
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
