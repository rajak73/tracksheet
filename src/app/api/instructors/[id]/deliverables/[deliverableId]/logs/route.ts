import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor, assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";

const LogInput = z.object({
  workDate: z.string(),
  quantityCompleted: z.number().int().min(0),
  hoursSpent: z.number().min(0),
  remarks: z.string().max(500).optional(),
});

async function requireDeliverable(
  scope: Parameters<typeof assertCanReadInstructor>[0],
  instructorId: string,
  deliverableId: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    // managerId and the primary manager ride along for `assertWritable`.
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  assertCanReadInstructor(scope, instructor);

  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, instructorId: instructor.id },
    select: { id: true, targetQuantity: true, status: true },
  });
  if (!deliverable) throw new ApiError(404, "NOT_FOUND", "Deliverable not found");

  return { instructor, deliverable };
}

export const GET = withAuth<{ id: string; deliverableId: string }>(async ({ params, scope }) => {
  const { deliverable } = await requireDeliverable(scope, params.id, params.deliverableId);
  const logs = await prisma.deliverableLog.findMany({
    where: { deliverableId: deliverable.id },
    orderBy: { workDate: "asc" },
  });
  return NextResponse.json({ logs });
});

/**
 * Records progress against a deliverable.
 *
 * Unlike assigning work, LOGGING it is something an instructor does for
 * themselves — the scope check allows self, manager, and admin alike. Progress
 * is recorded as dated increments rather than a mutable "percent complete"
 * field, which is what lets a weekly report be reconstructed for any period
 * without storing week columns.
 */
/**
 * The write-level check.
 *
 * Logging progress adds HOURS against a deliverable, and those hours reach the
 * client's reports. The helper this route shares with the GET authorises with
 * `assertCanReadInstructor`, which compares only the university for a manager —
 * correct for reading the log, wrong for appending to it, and the same
 * read-for-a-write mistake found on activity creation and leave.
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

export const POST = withAuth<{ id: string; deliverableId: string }>(
  async ({ params, req, scope, principal }) => {
    const input = LogInput.parse(await req.json().catch(() => null));
    assertValidDate(input.workDate);

    const { instructor, deliverable } = await requireDeliverable(
      scope,
      params.id,
      params.deliverableId,
    );
    assertWritable(scope, instructor);

    const log = await prisma.deliverableLog.create({
      data: {
        deliverableId: deliverable.id,
        universityId: instructor.universityId,
        instructorId: instructor.id,
        workDate: toDateOnly(input.workDate),
        quantityCompleted: input.quantityCompleted,
        hoursSpent: input.hoursSpent,
        remarks: input.remarks,
      },
    });

    // Status is derived from the logs rather than set by hand, so it cannot
    // disagree with the increments behind it.
    const totals = await prisma.deliverableLog.aggregate({
      where: { deliverableId: deliverable.id },
      _sum: { quantityCompleted: true },
    });
    const done = totals._sum.quantityCompleted ?? 0;
    /* CANCELLED is a DECISION, not a position on the progress scale, so it is
     * not something an increment may overwrite. Recomputing it unconditionally
     * moved a called-off deliverable back to IN_PROGRESS the moment a stale tab
     * logged against it — putting it back on the dashboards and back into the
     * deadline sweep, which excludes exactly COMPLETED and CANCELLED. */
    if (deliverable.status !== "CANCELLED") {
      await prisma.deliverable.update({
        where: { id: deliverable.id },
        data: {
          status:
            done >= deliverable.targetQuantity
              ? "COMPLETED"
              : done > 0
                ? "IN_PROGRESS"
                : "NOT_STARTED",
        },
      });
    }

    await logAudit(principal, scope, {
      action: "DELIVERABLE_PROGRESS_LOGGED",
      entityType: "DeliverableLog",
      entityId: log.id,
      universityId: instructor.universityId,
      metadata: { deliverableId: deliverable.id, quantityCompleted: input.quantityCompleted },
    });

    return NextResponse.json({ log }, { status: 201 });
  },
);
