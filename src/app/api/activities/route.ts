import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { instructorOwnedWhere, narrowManager } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { parseDateParam, parseLimit, parsePage } from "@/server/http/params";

/**
 * The activity-log explorer: what people actually recorded, one page at a time.
 *
 * ── Why this exists next to /universities/[id]/activities ──────────────────
 * That route answers "this university's activity" and returns the lot — an
 * unbounded read this deliberately does not repeat. This one is the operational
 * explorer: it spans the caller's whole scope, filters on the dimensions an
 * admin actually investigates by, and is ALWAYS paginated. There is no way to
 * ask it for everything.
 *
 * It reports raw records and computes nothing. Aggregation belongs to the
 * analytics engine; mixing the two is how two screens start disagreeing about
 * the same day.
 */

export const GET = withAuth(async ({ scope, req }) => {
  const sp = req.nextUrl.searchParams;

  const page = parsePage(sp.get("page"));
  const limit = parseLimit(sp.get("limit"), { fallback: 50, max: 200 });

  const from = parseDateParam(sp.get("from"), "from");
  const to = parseDateParam(sp.get("to"), "to");
  if (from && to && from > to) {
    throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`");
  }

  // Tenant and self-scope in one place: an instructor is pinned to their own
  // rows, a manager to their university, an admin may narrow to one tenant.
  const scopeWhere = instructorOwnedWhere(scope, sp.get("universityId"));
  // Roster dimension, authorised by the same helper the tracker uses: an admin
  // may name any manager, a manager only themselves, an instructor not at all.
  const managerFilter = narrowManager(scope, sp.get("managerId"));

  const instructorId = sp.get("instructorId");
  if (instructorId && scope.kind === "self" && instructorId !== scope.instructorId) {
    throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  }

  const activityTypeCode = sp.get("activityType");
  const search = sp.get("search")?.trim();

  const where = {
    ...scopeWhere,
    ...(instructorId ? { instructorId } : {}),
    // `managerId` lives on Instructor, so the roster filter is expressed as a
    // relation filter rather than a column on ActivityLog.
    ...("managerId" in managerFilter ? { instructor: { managerId: managerFilter.managerId } } : {}),
    ...(activityTypeCode ? { activityType: { code: activityTypeCode } } : {}),
    ...(from || to
      ? { workDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { instructor: { user: { name: { contains: search, mode: "insensitive" as const } } } },
            { instructor: { employeeCode: { contains: search, mode: "insensitive" as const } } },
            { remarks: { contains: search, mode: "insensitive" as const } },
            // The instructor's own words for what they produced. The worklog
            // screen offers "search by deliverable, remarks", and the
            // deliverable IS this column — without it that search only ever
            // matched half of what it offered.
            { rawText: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [activities, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      // Newest first: an explorer is nearly always asked "what happened
      // recently", and the (instructorId, startTime) index serves this.
      orderBy: [{ workDate: "desc" }, { startTime: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        workDate: true,
        startTime: true,
        endTime: true,
        status: true,
        remarks: true,
        activityType: { select: { code: true, label: true, countsAsProductive: true } },
        // The client's report is per DELIVERABLE, not per category, and its
        // quantity column is what a week of teaching is actually counted in.
        // Reading them here is what lets one endpoint serve both the calendar
        // and the sheet rather than the sheet needing a second query.
        deliverableType: { select: { code: true, label: true, isCountable: true } },
        broadCategory: { select: { code: true, label: true } },
        quantity: true,
        rawText: true,
        instructor: {
          select: {
            id: true,
            employeeCode: true,
            /* The instructor's OWN Broad Category, as assigned to them.
             *
             * Not the same thing as `broadCategory` on the row above, which is
             * the subject read out of that one activity's wording. The client's
             * rule for the report column is to print the category they supplied
             * and never to guess one from the work, so the report needs the
             * assigned value — and it travels here, beside the name and employee
             * code it belongs to, rather than in a second request that could
             * answer about somebody else. */
            category: { select: { code: true, label: true } },
            user: { select: { name: true } },
            manager: { select: { id: true, user: { select: { name: true } } } },
            university: { select: { id: true, name: true, code: true, timezone: true } },
          },
        },
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return NextResponse.json({
    activities: activities.map((a) => ({
      id: a.id,
      workDate: a.workDate,
      startTime: a.startTime,
      endTime: a.endTime,
      // Computed once here so every consumer shows the same duration rather
      // than each subtracting the timestamps its own way.
      durationHours:
        Math.round(((a.endTime.getTime() - a.startTime.getTime()) / 3_600_000) * 100) / 100,
      status: a.status,
      remarks: a.remarks,
      activityType: a.activityType,
      deliverableType: a.deliverableType,
      broadCategory: a.broadCategory,
      quantity: a.quantity,
      rawText: a.rawText,
      instructorId: a.instructor.id,
      instructorName: a.instructor.user.name,
      employeeCode: a.instructor.employeeCode,
      // Null when nobody has assigned one. The report prints "Not Provided"
      // rather than filling it in from the day's activities.
      instructorCategory: a.instructor.category,
      // Explicitly null rather than omitted: "nobody leads this person yet" is
      // a state the explorer should show, not hide.
      manager: a.instructor.manager
        ? { id: a.instructor.manager.id, name: a.instructor.manager.user.name }
        : null,
      university: a.instructor.university,
    })),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
});
