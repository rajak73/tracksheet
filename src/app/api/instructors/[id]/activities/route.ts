import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { parseDateParam, parseLimit, parsePage } from "@/server/http/params";
import { logActivity } from "@/server/activities/logger";
import { logAudit } from "@/server/audit/logger";

/**
 * Two accepted interval forms (see LogActivityInput in the logger):
 * absolute instants, or the wall-clock fields a person typed, resolved
 * server-side against the UNIVERSITY's timezone. The UI sends the local
 * form — building instants in the browser used `new Date()` in the
 * BROWSER's zone and silently booked work on the wrong university-local day.
 */
const PostActivityInput = z
  .object({
    activityTypeCode: z.string().min(1),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    local: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .optional(),
    status: z.enum(["COMPLETED", "MISSED", "LATE", "EXCUSED"]).optional(),
    remarks: z.string().optional(),
  })
  .refine((v) => v.local !== undefined || (v.startTime !== undefined && v.endTime !== undefined), {
    message: "Provide either startTime/endTime or local {date, start, end}",
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
    startTime: input.startTime ? new Date(input.startTime) : undefined,
    endTime: input.endTime ? new Date(input.endTime) : undefined,
    local: input.local,
    status: input.status,
    remarks: input.remarks,
  });

  await logAudit(principal, scope, {
    action: "ACTIVITY_LOGGED",
    entityType: "ActivityLog",
    entityId: log.id,
    universityId: instructor.universityId,
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

  // Validated up front so a malformed ?from= is a 400, not a Prisma crash.
  const fromDate = parseDateParam(from, "from");
  const toDate = parseDateParam(to, "to");
  const page = parsePage(url.searchParams.get("page"));
  const limit = parseLimit(url.searchParams.get("limit"), { fallback: 100, max: 500 });

  let dateFilter = {};
  if (fromDate || toDate) {
    dateFilter = {
      workDate: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    };
  }

  const where = { instructorId: instructor.id, ...dateFilter };

  const [activities, total, university] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
        activityType: true,
      },
      orderBy: {
        startTime: "asc",
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.activityLog.count({ where }),
    prisma.university.findUnique({
      where: { id: instructor.universityId },
      select: { timezone: true },
    }),
  ]);

  // The zone these instants should be DISPLAYED in. Without it, pages fell
  // back to rendering UTC — an instructor typed 10:00 and read back 04:30.
  return NextResponse.json({
    activities,
    timezone: university?.timezone ?? "UTC",
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
});
