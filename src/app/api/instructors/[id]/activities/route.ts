import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor, assertCanReadInstructorWork } from "@/server/auth/scope";
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
  
  // Verify access and get the instructor to find their universityId.
  // `managerId` and the university's primary manager come along because the
  // WRITE check below needs them.
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });

  if (!instructor) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Instructor not found" } },
      { status: 404 }
    );
  }

  /* ── Recording somebody's hours is a write, so the roster decides ────────
   * This used `assertCanReadInstructor`, which for a manager compares only the
   * university. A probe confirmed what that allowed: a manager posted a
   * TEACHING block, with free-text `remarks`, onto an instructor belonging to
   * a DIFFERENT manager in the same university, and got 201.
   *
   * That is not a cosmetic boundary. Hours posted here flow into Working Hours,
   * utilization and every report the client reads, so one manager could move
   * another manager's numbers, and the row would carry the instructor's name
   * rather than the author's.
   *
   * `assertCanManageInstructor` is the same check the deliverable, schedule and
   * reminder routes already use. It runs the read check first — so an
   * instructor is still pinned to themselves and an admin still passes — and
   * only then requires a manager to own the roster entry, with the university's
   * primary manager standing in for an unassigned instructor. */
  assertCanManageInstructor(scope, instructor, instructor.university.primaryManagerId);

  /* ── Why the today-only rule is NOT applied here ────────────────────────
   * The worklog routes hold an instructor to today, and the activity edit and
   * delete routes beside this one do too. This one deliberately does not, and
   * the distinction is worth stating because the asymmetry looks like an
   * oversight and is not.
   *
   * This is the general activity API. It predates the worklog feature, it is
   * how a manager records somebody's hours, and it is how history gets built
   * at all — a comparison of this week against last week cannot be expressed
   * by a route that only accepts today. Holding it to today broke twenty-six
   * suites, several of which are legitimately about multi-day arithmetic
   * rather than about lax fixtures.
   *
   * What that leaves: an instructor can still create a past-dated row through
   * this route directly, and then be refused permission to edit or delete it.
   * That is a real wart. It is bounded rather than open — no instructor screen
   * offers a non-today date into it any more (the date fields on
   * instructor/activities and instructor/activity-tracker are pinned to today)
   * — and closing it properly means deciding what a manager-built history is
   * supposed to look like, which is a product question rather than a patch. */

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
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });

  if (!instructor) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Instructor not found" } },
      { status: 404 }
    );
  }

  /* Roster-level, not tenant-level: this returns the instructor's own work, and
   * a manager's reach over that is their roster. See the note on
   * `assertCanReadInstructorWork`. An off-roster id answers 404, exactly as an
   * unknown one does. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

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
