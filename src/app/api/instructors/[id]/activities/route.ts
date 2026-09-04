import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { parseDateParam, parseLimit, parsePage } from "@/server/http/params";

/**
 * Two accepted interval forms (see LogActivityInput in the logger):
 * absolute instants, or the wall-clock fields a person typed, resolved
 * server-side against the UNIVERSITY's timezone. The UI sends the local
 * form — building instants in the browser used `new Date()` in the
 * BROWSER's zone and silently booked work on the wrong university-local day.
 */
/* `POST /activities` is gone, with `ActivityLog` and the taxonomy it wrote.
 *
 * It took an `activityTypeCode`, resolved it against `ActivityType`, enforced
 * that type's `isOncePerDay` flag and wrote a row. None of those three things
 * exists now: the type table is dropped, one row per instructor per day makes
 * once-per-day structurally true, and a day is written through the worklog
 * route. `server/activities/logger.ts` went with it — it had no other caller.
 */

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } } } });

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
        ...(toDate ? { lte: toDate } : {}) } };
  }

  const where = { instructorId: instructor.id, ...dateFilter };

  const [activities, total, university] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      include: {
      },
      orderBy: {
        startTime: "asc" },
      skip: (page - 1) * limit,
      take: limit }),
    prisma.activityLog.count({ where }),
    prisma.university.findUnique({
      where: { id: instructor.universityId },
      select: { timezone: true } }),
  ]);

  // The zone these instants should be DISPLAYED in. Without it, pages fell
  // back to rendering UTC — an instructor typed 10:00 and read back 04:30.
  return NextResponse.json({
    activities,
    timezone: university?.timezone ?? "UTC",
    page,
    limit,
    total,
    hasMore: page * limit < total });
});
