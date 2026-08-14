import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

/**
 * Revokes a leave request.
 *
 * Management-only for the same reason approval is: removing approved leave puts
 * the day back into available capacity, which changes the instructor's
 * utilisation denominator. The instructor whose leave it is must not be able to
 * do that to their own figures in either direction.
 */
export const DELETE = withAuth<{ id: string; leaveId: string }>(
  async ({ params, scope, principal }) => {
    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id },
      select: { id: true, universityId: true },
    });
    if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    assertCanReadInstructor(scope, instructor);

    // Scoped by instructorId in the predicate, so a leave id belonging to
    // another instructor cannot be removed even by guessing it.
    const result = await prisma.leaveRequest.deleteMany({
      where: { id: params.leaveId, instructorId: instructor.id },
    });
    if (result.count === 0) throw new ApiError(404, "NOT_FOUND", "Leave request not found");

    await logAudit(principal, scope, {
      action: "LEAVE_REVOKED",
      entityType: "LeaveRequest",
      entityId: params.leaveId,
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id },
    });

    return NextResponse.json({ ok: true });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
