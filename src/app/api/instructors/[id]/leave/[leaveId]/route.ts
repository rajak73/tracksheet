import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanManageInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { workDateFor } from "@/server/time/workday";
import { recomputeDay } from "@/server/analytics/rollup";

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
      select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
    });
    if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    /* Manage, not read. Revoking somebody's leave changes their capacity — and
       therefore their manager's figures — so this is a write on that manager's
       roster, not a read of the tenant. */
    assertCanManageInstructor(scope, instructor, instructor.university.primaryManagerId);

    /* Read before deleting, because the days it covered have to be
     * re-summarised afterwards and the row is the only place they are recorded.
     * Scoped by instructorId in the predicate for the same reason the delete is:
     * a leave id belonging to another instructor must not be reachable even by
     * guessing it. */
    const leave = await prisma.leaveRequest.findFirst({
      where: { id: params.leaveId, instructorId: instructor.id },
      select: { startDate: true, endDate: true, status: true },
    });
    if (!leave) throw new ApiError(404, "NOT_FOUND", "Leave request not found");

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

    /* APPROVED leave removes days from capacity, so revoking it puts them back
     * — and the stored metrics for those days are now wrong. The scheduler only
     * recomputes a short trailing window, so leave revoked on anything older
     * than that would have stayed wrong forever. See `recomputeDay`. */
    if (leave.status === "APPROVED") {
      await recomputeDay(
        instructor.universityId,
        workDateFor(leave.startDate, "UTC"),
        workDateFor(leave.endDate, "UTC"),
      );
    }

    return NextResponse.json({ ok: true });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
