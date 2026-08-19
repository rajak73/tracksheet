import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { z } from "zod";
import { BRIEF_TYPE } from "@/server/ai/brief-type";

const updateInsightSchema = z.object({
  status: z.enum(["NEW", "READ", "DISMISSED"]),
});

/**
 * Insights are a management artifact (see the GET/POST on
 * /api/universities/[id]/insights) — an instructor must not read or mutate
 * one, even their own university's. The role gate below is what enforces
 * that; `assertCanAccessUniversity` only compares tenant, not role, so it is
 * not sufficient here on its own (this route previously omitted the gate).
 */
export const PATCH = withAuth<{ id: string }>(
  async ({ req, params, scope }) => {
    const { id: insightId } = params;
    const data = updateInsightSchema.parse(await req.json().catch(() => null));

    const insight = await prisma.aiInsight.findUnique({
      where: { id: insightId },
      select: { universityId: true, type: true }
    });

    if (!insight) {
      throw new ApiError(404, "NOT_FOUND", "Insight not found");
    }

    // An assistant brief is not a management artifact to be triaged: it belongs
    // to whoever it was written for, and this route answers with the whole row,
    // so reaching one by id would disclose its subject's figures to any manager
    // in the same university. Absent as far as this endpoint is concerned.
    if (insight.type === BRIEF_TYPE) {
      throw new ApiError(404, "NOT_FOUND", "Insight not found");
    }

    // universityId is now nullable because PLATFORM-scoped insights have no
    // tenant. Those are admin-only; anything tenant-scoped goes through the
    // normal check.
    if (insight.universityId === null) {
      if (scope.kind !== "global") {
        throw new ApiError(404, "NOT_FOUND", "Insight not found");
      }
    } else {
      assertCanAccessUniversity(scope, insight.universityId);
    }

    const updated = await prisma.aiInsight.update({
      where: { id: insightId },
      data: { status: data.status },
    });

    return NextResponse.json(updated);
  },
  { roles: ["ADMIN", "MANAGER"] },
);
