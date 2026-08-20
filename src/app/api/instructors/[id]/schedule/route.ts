import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor, assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate, computeDayWindows } from "@/server/time/schedule-windows";
import { loadUniversityConfig } from "@/server/universities/config";
import { toDateOnly, workDateFor } from "@/server/time/workday";

async function visibleInstructor(
  scope: Parameters<typeof assertCanReadInstructor>[0],
  id: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  assertCanReadInstructor(scope, instructor);
  return instructor;
}

/**
 * An instructor's planned day.
 *
 * Returns the configured opening/closing windows alongside the planned slots,
 * because "today's schedule" is both: the university-derived bookends plus
 * whatever was planned in between. The bookends are computed, never stored as
 * slots — that is what keeps them once-per-day rather than schedulable items
 * someone could duplicate.
 */
export const GET = withAuth<{ id: string }>(async ({ params, scope, req }) => {
  const instructor = await visibleInstructor(scope, params.id);
  const config = await loadUniversityConfig(instructor.universityId);

  const date = req.nextUrl.searchParams.get("date") ?? workDateFor(new Date(), config.timezone);
  assertValidDate(date);

  const windows = computeDayWindows(config, date);

  const slots = await prisma.scheduleSlot.findMany({
    where: { instructorId: instructor.id, workDate: toDateOnly(date) },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      location: true,
      status: true,
      activityType: { select: { code: true, label: true } },
      course: { select: { code: true, title: true } },
    },
  });

  // Actual logged activity for the same day, so a UI can show planned against
  // recorded without a second request or any client-side joining.
  const logged = await prisma.activityLog.findMany({
    where: { instructorId: instructor.id, workDate: toDateOnly(date) },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      scheduleSlotId: true,
      activityType: { select: { code: true, label: true } },
    },
  });

  return NextResponse.json({
    date,
    timezone: config.timezone,
    isWorkingDay: windows.isWorkingDay,
    nonWorkingReason: windows.nonWorkingReason,
    opening: windows.opening,
    closing: windows.closing,
    workingHours: windows.workingHours,
    slots,
    logged,
  });
});

const SlotInput = z.object({
  date: z.string(),
  activityTypeCode: z.string().min(1),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  courseId: z.string().optional(),
  location: z.string().max(200).optional(),
});

/**
 * Planning an instructor's day is a management action, so instructors cannot
 * schedule themselves — they record what actually happened via /activities.
 */
/**
 * The write-level check.
 *
 * `loadInstructor` above asks "may you see this person", which for a manager is
 * a tenant comparison. Writing is a different question: a manager runs ONE
 * roster, so acting on a peer's instructor is out of bounds even inside their
 * own university. Unassigned instructors fall to the primary manager, the same
 * rule the roster and the approval queue use.
 */
function assertWritable(scope: Parameters<typeof assertCanManageInstructor>[0], instructor: {
  id: string;
  universityId: string;
  managerId: string | null;
  university: { primaryManagerId: string | null };
}) {
  assertCanManageInstructor(scope, instructor, instructor.university.primaryManagerId);
}

export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = SlotInput.parse(await req.json().catch(() => null));
    assertValidDate(input.date);

    const instructor = await visibleInstructor(scope, params.id);
    assertWritable(scope, instructor);

    if (new Date(input.endTime) <= new Date(input.startTime)) {
      throw new ApiError(400, "INVALID_INTERVAL", "endTime must be after startTime");
    }

    const activityType = await prisma.activityType.findUnique({
      where: { code: input.activityTypeCode },
      select: { id: true, isDerivedFromWorkingHours: true },
    });
    if (!activityType) {
      throw new ApiError(404, "ACTIVITY_TYPE_NOT_FOUND", "Activity type not found");
    }
    if (activityType.isDerivedFromWorkingHours) {
      // Opening and closing come from the university's configured hours. Making
      // them schedulable would let one working day carry several of each.
      throw new ApiError(
        400,
        "NOT_SCHEDULABLE",
        `${input.activityTypeCode} is derived from working hours and cannot be scheduled`,
      );
    }

    const slot = await prisma.scheduleSlot.create({
      data: {
        universityId: instructor.universityId,
        instructorId: instructor.id,
        activityTypeId: activityType.id,
        courseId: input.courseId,
        workDate: toDateOnly(input.date),
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
        location: input.location,
      },
    });

    await logAudit(principal, scope, {
      action: "SCHEDULE_SLOT_CREATED",
      entityType: "ScheduleSlot",
      entityId: slot.id,
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id, date: input.date },
    });

    return NextResponse.json({ slot }, { status: 201 });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
