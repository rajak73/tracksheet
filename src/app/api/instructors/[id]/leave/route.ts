import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";
import { logAudit } from "@/server/audit/logger";

const LeaveInput = z.object({
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  reason: z.string().max(500).optional(),
});

async function visibleInstructor(
  scope: Parameters<typeof assertCanReadInstructor>[0],
  id: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id },
    select: { id: true, universityId: true },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  assertCanReadInstructor(scope, instructor);
  return instructor;
}

export const GET = withAuth<{ id: string }>(async ({ params, scope }) => {
  const instructor = await visibleInstructor(scope, params.id);
  const leaveRequests = await prisma.leaveRequest.findMany({
    where: { instructorId: instructor.id },
    orderBy: { startDate: "desc" },
  });
  return NextResponse.json({ leaveRequests });
});

/**
 * An instructor may SUBMIT a leave request for themselves, but only a manager
 * or admin may APPROVE one. Approved leave shrinks available capacity, so
 * self-approval would let an instructor improve their own utilisation figure by
 * declaring a day off.
 */
export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = LeaveInput.parse(await req.json().catch(() => null));
    assertValidDate(input.startDate);
    assertValidDate(input.endDate);
    if (input.endDate < input.startDate) {
      throw new ApiError(400, "INVALID_RANGE", "endDate must not be before startDate");
    }

    const instructor = await visibleInstructor(scope, params.id);

    // A self-scoped caller is pinned to PENDING regardless of what was sent.
    const isSelfScoped = scope.kind === "self";
    if (isSelfScoped && input.status && input.status !== "PENDING") {
      throw new ApiError(403, "FORBIDDEN", "Only a manager or admin can approve leave");
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        instructorId: instructor.id,
        universityId: instructor.universityId,
        startDate: toDateOnly(input.startDate),
        endDate: toDateOnly(input.endDate),
        status: isSelfScoped ? "PENDING" : (input.status ?? "PENDING"),
        reason: input.reason,
      },
    });

    await logAudit(principal, scope, {
      action: "LEAVE_RECORDED",
      entityType: "LeaveRequest",
      entityId: leave.id,
      metadata: { instructorId: instructor.id, status: leave.status },
    });

    return NextResponse.json({ leave }, { status: 201 });
  },
);
