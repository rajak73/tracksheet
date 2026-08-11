import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { z } from "zod";
import { logAudit } from "@/server/audit/logger";

const createDeliverableSchema = z.object({
  title: z.string().min(1).max(300),
  targetQuantity: z.number().int().min(1),
  targetHours: z.number().min(0.5),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

/** Resolves the target instructor and authorises the caller against them. */
async function requireVisibleInstructor(
  scope: Parameters<typeof assertCanReadInstructor>[0],
  instructorId: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    select: { id: true, universityId: true },
  });

  if (!instructor) {
    throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  }

  // assertCanReadInstructor, NOT assertCanAccessUniversity: the latter only
  // compares the tenant, so a self-scoped caller would pass for any colleague
  // in their own university.
  assertCanReadInstructor(scope, instructor);
  return instructor;
}

export const GET = withAuth<{ id: string }>(async ({ params, scope }) => {
  const instructor = await requireVisibleInstructor(scope, params.id);

  const deliverables = await prisma.deliverable.findMany({
    where: { instructorId: instructor.id },
    include: { logs: { orderBy: { date: "asc" } } },
    orderBy: { dueDate: "asc" },
  });

  return NextResponse.json({ deliverables });
});

/**
 * Assigning work is a management action, so instructors cannot create
 * deliverables — not even on themselves. The role gate runs in withAuth, and
 * the tenant/ownership check still runs below for managers.
 */
export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const data = createDeliverableSchema.parse(await req.json().catch(() => null));
    const instructor = await requireVisibleInstructor(scope, params.id);

    const deliverable = await prisma.deliverable.create({
      data: {
        instructorId: instructor.id,
        universityId: instructor.universityId,
        title: data.title,
        targetQuantity: data.targetQuantity,
        targetHours: data.targetHours,
        dueDate: new Date(data.dueDate),
      },
    });

    await logAudit(principal, scope, {
      action: "DELIVERABLE_CREATED",
      entityType: "Deliverable",
      entityId: deliverable.id,
      metadata: { instructorId: instructor.id, title: data.title },
    });

    return NextResponse.json({ deliverable }, { status: 201 });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
