import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
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
    select: { id: true, universityId: true },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  assertCanReadInstructor(scope, instructor);

  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, instructorId: instructor.id },
    select: { id: true, targetQuantity: true },
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
export const POST = withAuth<{ id: string; deliverableId: string }>(
  async ({ params, req, scope, principal }) => {
    const input = LogInput.parse(await req.json().catch(() => null));
    assertValidDate(input.workDate);

    const { instructor, deliverable } = await requireDeliverable(
      scope,
      params.id,
      params.deliverableId,
    );

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

    await logAudit(principal, scope, {
      action: "DELIVERABLE_PROGRESS_LOGGED",
      entityType: "DeliverableLog",
      entityId: log.id,
      metadata: { deliverableId: deliverable.id, quantityCompleted: input.quantityCompleted },
    });

    return NextResponse.json({ log }, { status: 201 });
  },
);
