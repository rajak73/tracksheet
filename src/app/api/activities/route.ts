import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { instructorOwnedWhere, narrowManager } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { parseDateParam, parseLimit, parsePage } from "@/server/http/params";
import { dayInsightStatuses } from "@/server/insights/day-status";

/**
 * The worklog explorer: what people recorded, one page at a time.
 *
 * ── Why this exists next to /universities/[id]/activities ──────────────────
 * That route answers "this university's activity" and returns the lot — an
 * unbounded read this deliberately does not repeat. This one is the operational
 * explorer: it spans the caller's whole scope, filters on the dimensions
 * somebody actually investigates by, and is ALWAYS paginated. There is no way to
 * ask it for everything.
 *
 * It reports raw records and computes nothing. Aggregation belongs to the
 * analytics engine; mixing the two is how two screens start disagreeing about
 * the same day.
 *
 * ── One row per day ────────────────────────────────────────────────────────
 * A page is now a page of DAYS rather than of activities. That is what the
 * screen was always assembling anyway: the table grouped rows into days on the
 * client, which meant a busy day written in eleven rows could straddle a page
 * boundary and appear twice, each time showing the whole day's figures. A day is
 * a row here, so it cannot.
 *
 * ── What is deliberately gone ──────────────────────────────────────────────
 * The activity type, deliverable type and broad category, and the filters that
 * narrowed by them. There is no taxonomy to filter on; `deliverable` is free
 * text and `search` reads it directly.
 */

export const GET = withAuth(async ({ scope, req }) => {
  const sp = req.nextUrl.searchParams;
  const page = parsePage(sp.get("page"));
  const limit = parseLimit(sp.get("limit"), { fallback: 50, max: 200 });

  const from = parseDateParam(sp.get("from"), "from");
  const to = parseDateParam(sp.get("to"), "to");
  if (from && to && from.getTime() > to.getTime()) {
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

  const search = sp.get("search")?.trim();

  const where = {
    ...scopeWhere,
    ...(instructorId ? { instructorId } : {}),
    // `managerId` lives on Instructor, so the roster filter is expressed as a
    // relation filter rather than a column on the day row.
    ...("managerId" in managerFilter ? { instructor: { managerId: managerFilter.managerId } } : {}),
    /* `parseDateParam` returns a Date already. Wrapping it again produced
       `new Date("Invalid Date")`, which Prisma rejected — the bound was never a
       string to interpolate. */
    ...(from || to
      ? { logDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    /* Free text, across the three boxes that hold words. There is no category to
       match on any more, and searching what somebody wrote is what people were
       reaching for the category filter to approximate. */
    ...(search
      ? {
          OR: [
            { deliverable: { contains: search, mode: "insensitive" as const } },
            { deliverableQuantity: { contains: search, mode: "insensitive" as const } },
            { remarks: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, days] = await Promise.all([
    prisma.worklogEntry.count({ where }),
    prisma.worklogEntry.findMany({
      where,
      // Newest first: the question is almost always "what happened recently".
      orderBy: [{ logDate: "desc" }, { instructorId: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        logDate: true,
        deliverable: true,
        deliverableQuantity: true,
        workingHours: true,
        remarks: true,
        status: true,
        source: true,
        instructor: {
          select: {
            id: true,
            employeeCode: true,
            user: { select: { name: true } },
            manager: { select: { id: true, user: { select: { name: true } } } },
            university: { select: { id: true, name: true, code: true, timezone: true } },
          },
        },
      },
    }),
  ]);

  /* The insight cell's state per day, read from the cache and NEVER generated.
     A table rendering a column must not be able to start paying for it: paging
     back through a month would otherwise buy a month of insights.

     Only for a single instructor's own page — across a roster the dates belong
     to different people and one map keyed by date could not say whose. The
     manager's sheet gets this in its own commit. */
  const insights =
    instructorId && days.length > 0
      ? await dayInsightStatuses(
          instructorId,
          days[days.length - 1]!.logDate.toISOString().slice(0, 10),
          days[0]!.logDate.toISOString().slice(0, 10),
        )
      : {};

  return NextResponse.json({
    insights,
    days: days.map((d) => ({
      id: d.id,
      logDate: d.logDate.toISOString().slice(0, 10),
      /* The three free-text boxes, verbatim. Nothing here is parsed, trimmed or
         tidied on the way out — "gfddgh" is what somebody wrote, and a display
         layer that improves it is hiding the record. */
      deliverable: d.deliverable,
      deliverableQuantity: d.deliverableQuantity,
      // A number, so the client formats it once rather than parsing a string.
      workingHours: Number(d.workingHours),
      remarks: d.remarks,
      status: d.status,
      /* Provenance, not content. `MIGRATED` means the text was reconstructed by
         the collapse from the old taxonomy's labels rather than written by the
         instructor — see `WorklogEntry.source`. */
      source: d.source,
      instructorId: d.instructor.id,
      instructorName: d.instructor.user.name,
      employeeCode: d.instructor.employeeCode,
      // Explicitly null rather than omitted: "nobody leads this person yet" is
      // a state the explorer should show, not hide.
      manager: d.instructor.manager
        ? { id: d.instructor.manager.id, name: d.instructor.manager.user.name }
        : null,
      university: d.instructor.university,
    })),
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
});
