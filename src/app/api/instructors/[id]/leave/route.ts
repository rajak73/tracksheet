import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor, assertCanReadInstructorWork } from "@/server/auth/scope";
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
  scope: Parameters<typeof assertCanReadInstructorWork>[0],
  id: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id },
    // `managerId` and the primary manager ride along for `assertWritable`,
    // which the POST needs and the GET does not.
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  /* Roster-level, not tenant-level: this reports an individual's work, and a
   * manager's reach over that is their roster. An off-roster id answers 404,
   * exactly as an unknown one does — see `assertCanReadInstructorWork`. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);
  return instructor;
}

/**
 * The write-level check — booking or approving leave, not reading it.
 *
 * ── What reading-level authorisation allowed here ─────────────────────────
 * This route resolved its instructor through `visibleInstructor` and then
 * wrote, and that helper asks `assertCanReadInstructor`, which for a manager
 * compares only the university. A probe confirmed the consequence: a manager
 * posted leave for an instructor on a DIFFERENT manager's roster, with
 * `status: "APPROVED"` in the body, and got 201.
 *
 * Leave is not an annotation. APPROVED leave REMOVES days from available
 * capacity — the comment below this one says so — so it changes the
 * denominator of that instructor's utilization and every figure derived from
 * it. One manager could quietly reshape another manager's numbers.
 *
 * The same check the deliverable, schedule and reminder routes use. An
 * instructor requesting their own leave is unaffected: the read check pins a
 * self scope to itself and `assertCanManageInstructor` returns before the
 * roster rule for any scope that is not a manager's.
 */
function assertWritable(
  scope: Parameters<typeof assertCanManageInstructor>[0],
  instructor: {
    id: string;
    universityId: string;
    managerId: string | null;
    university: { primaryManagerId: string | null };
  },
) {
  assertCanManageInstructor(scope, instructor, instructor.university.primaryManagerId);
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
    assertWritable(scope, instructor);

    // A self-scoped caller is pinned to PENDING regardless of what was sent.
    const isSelfScoped = scope.kind === "self";
    if (isSelfScoped && input.status && input.status !== "PENDING") {
      throw new ApiError(403, "FORBIDDEN", "Only a manager or admin can approve leave");
    }

    const startDate = toDateOnly(input.startDate);
    const endDate = toDateOnly(input.endDate);

    // Overlapping leave is rejected because APPROVED leave REMOVES a day from
    // available capacity (see `computeAnalytics`). Two rows covering the same
    // day would deduct it twice, shrinking the denominator below the real
    // figure and inflating utilization — a silent corruption of every
    // downstream metric rather than a visible duplicate.
    //
    // Only APPROVED leave affects capacity, but a PENDING duplicate is
    // blocked too: it would otherwise become a double deduction the moment a
    // manager approves it. Standard interval test — existing.start <= new.end
    // AND existing.end >= new.start.
    const clash = await prisma.leaveRequest.findFirst({
      where: {
        instructorId: instructor.id,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true, startDate: true, endDate: true, status: true },
    });
    if (clash) {
      const d = (x: Date) => x.toISOString().slice(0, 10);
      throw new ApiError(
        409,
        "OVERLAPPING_LEAVE",
        `This overlaps ${clash.status.toLowerCase()} leave already recorded from ${d(clash.startDate)} to ${d(clash.endDate)}.`,
      );
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        instructorId: instructor.id,
        universityId: instructor.universityId,
        startDate,
        endDate,
        status: isSelfScoped ? "PENDING" : (input.status ?? "PENDING"),
        reason: input.reason,
      },
    });

    await logAudit(principal, scope, {
      action: "LEAVE_RECORDED",
      entityType: "LeaveRequest",
      entityId: leave.id,
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id, status: leave.status },
    });

    return NextResponse.json({ leave }, { status: 201 });
  },
);
