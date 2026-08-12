import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";

export const GET = withAuth<{ id: string }>(async ({ params, scope }) => {
  assertCanAccessUniversity(scope, params.id);
  const targets = await prisma.workloadTarget.findMany({
    where: { universityId: params.id },
    orderBy: [{ effectiveFrom: "desc" }],
    include: { activityType: { select: { code: true, label: true } } },
  });
  return NextResponse.json({ targets });
});

const TargetInput = z.object({
  activityTypeCode: z.string().min(1),
  targetMinutes: z.number().int().positive(),
  periodType: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]).optional(),
  instructorId: z.string().optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
});

/**
 * Workload expectations are configuration, so admin-only — a manager measured
 * against a target should not be able to move it.
 *
 * Targets are effective-dated rather than overwritten, so changing this quarter's
 * expectation does not retroactively rewrite how last quarter is judged.
 */
export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = TargetInput.parse(await req.json().catch(() => null));
    assertCanAccessUniversity(scope, params.id);
    assertValidDate(input.effectiveFrom);
    if (input.effectiveTo) assertValidDate(input.effectiveTo);

    const activityType = await prisma.activityType.findUnique({
      where: { code: input.activityTypeCode },
      select: { id: true },
    });
    if (!activityType) throw new ApiError(404, "ACTIVITY_TYPE_NOT_FOUND", "Activity type not found");

    if (input.instructorId) {
      const instructor = await prisma.instructor.findFirst({
        where: { id: input.instructorId, universityId: params.id },
        select: { id: true },
      });
      if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found in this university");
    }

    const target = await prisma.workloadTarget.create({
      data: {
        universityId: params.id,
        instructorId: input.instructorId,
        activityTypeId: activityType.id,
        targetMinutes: input.targetMinutes,
        periodType: input.periodType ?? "WEEKLY",
        effectiveFrom: toDateOnly(input.effectiveFrom),
        effectiveTo: input.effectiveTo ? toDateOnly(input.effectiveTo) : null,
      },
    });

    await logAudit(principal, scope, {
      action: "WORKLOAD_TARGET_CHANGED",
      entityType: "WorkloadTarget",
      entityId: target.id,
      metadata: { activityType: input.activityTypeCode, targetMinutes: input.targetMinutes },
    });

    return NextResponse.json({ target }, { status: 201 });
  },
  { roles: ["ADMIN"] },
);
