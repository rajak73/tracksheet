import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { z } from "zod";

const updateInsightSchema = z.object({
  status: z.enum(["NEW", "READ", "DISMISSED"]),
});

export const PATCH = withAuth<{ id: string }>(async ({ req, params, scope }) => {
  const { id: insightId } = params;
  const body = await req.json();
  const data = updateInsightSchema.parse(body);

  const insight = await prisma.aiInsight.findUnique({
    where: { id: insightId },
    select: { universityId: true }
  });

  if (!insight) {
    throw new ApiError(404, "NOT_FOUND", "Insight not found");
  }

  assertCanAccessUniversity(scope, insight.universityId);

  const updated = await prisma.aiInsight.update({
    where: { id: insightId },
    data: { status: data.status },
  });

  return NextResponse.json(updated);
});
