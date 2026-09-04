import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor, assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate, computeDayWindows } from "@/server/time/schedule-windows";
import { loadUniversityConfig } from "@/server/universities/config";
import { toDateOnly, workDateFor } from "@/server/time/workday";

async function visibleInstructor(
  scope: Parameters<typeof assertCanReadInstructorWork>[0],
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
  /* Roster-level, not tenant-level: this reports an individual's work, and a
   * manager's reach over that is their roster. An off-roster id answers 404,
   * exactly as an unknown one does — see `assertCanReadInstructorWork`. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);
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

    /* The `ActivityType` lookup that stood here is gone with the table. It
       resolved a code to an id and refused the two types derived from the
       university's configured hours — a rule belonging to a taxonomy that no
       longer exists. `activityTypeCode` is still accepted so existing callers
       are not broken by a changed request shape; nothing resolves it. */

    /* The instants have to fall on the date they are filed under.
     *
     * `workDate` came from `input.date` and the times came from two absolute
     * instants the caller supplied, and nothing checked that they agreed. The
     * only client builds those instants in the BROWSER's zone, so a laptop set
     * to London — or a traveller, or any non-browser caller — could file a slot
     * under Monday whose times are on Tuesday. Every reader then either shows a
     * Monday slot at the wrong hour or a Tuesday slot missing from Tuesday.
     *
     * Judged in the UNIVERSITY's zone, which is what `workDate` means
     * everywhere else in this codebase. */
    const { timezone } = await loadUniversityConfig(instructor.universityId);
    const startsOn = workDateFor(new Date(input.startTime), timezone);
    const endsOn = workDateFor(new Date(input.endTime), timezone);
    if (startsOn !== input.date || endsOn !== input.date) {
      throw new ApiError(
        400,
        "TIMES_NOT_ON_DATE",
        `Those times fall on ${startsOn === endsOn ? startsOn : `${startsOn} and ${endsOn}`}, ` +
          `not on ${input.date}.`,
      );
    }

    const slot = await prisma.scheduleSlot.create({
      data: {
        universityId: instructor.universityId,
        instructorId: instructor.id,
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
