import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { logActivity } from "@/server/activities/logger";
import { logAudit } from "@/server/audit/logger";

const PostActivityInput = z.object({
  activityTypeCode: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: z.enum(["COMPLETED", "MISSED", "LATE", "EXCUSED"]).optional(),
  remarks: z.string().optional(),
});

export const POST = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  const input = PostActivityInput.parse(await req.json().catch(() => null));
  
  // Verify access and get the instructor to find their universityId
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: { id: true, universityId: true },
  });

  if (!instructor) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Instructor not found" } },
      { status: 404 }
    );
  }

  assertCanReadInstructor(scope, instructor);

  const log = await logActivity({
    instructorId: instructor.id,
    universityId: instructor.universityId,
    activityTypeCode: input.activityTypeCode,
    startTime: new Date(input.startTime),
    endTime: new Date(input.endTime),
    status: input.status,
    remarks: input.remarks,
  });

  await logAudit(principal, scope, {
    action: "ACTIVITY_LOGGED",
    entityType: "ActivityLog",
    entityId: log.id,
    metadata: { instructorId: instructor.id, activityType: input.activityTypeCode },
  });

  return NextResponse.json({ activity: log }, { status: 201 });
});

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: { id: true, universityId: true },
  });

  if (!instructor) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Instructor not found" } },
      { status: 404 }
    );
  }

  assertCanReadInstructor(scope, instructor);

  // Optional date filters
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let dateFilter = {};
  if (from || to) {
    dateFilter = {
      workDate: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    };
  }

  const activities = await prisma.activityLog.findMany({
    where: {
      instructorId: instructor.id,
      ...dateFilter,
    },
    include: {
      activityType: true,
    },
    orderBy: {
      startTime: "asc",
    },
  });

  return NextResponse.json({ activities });
});
