import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import {
  assertCanAccessUniversity,
  assertCanReadInstructor,
  narrowManager,
} from "@/server/auth/scope";
import { ApiError } from "@/server/http/errors";
import { buildTracker, formatTrackerAsCsv, mondayOf, monthBounds } from "@/server/analytics/tracker";
import { loadUniversityConfig } from "@/server/universities/config";
import { prisma } from "@/server/db";
import { parseDateParam } from "@/server/http/params";
import { logAudit } from "@/server/audit/logger";
import { workDateFor } from "@/server/time/workday";

/**
 * The weekly workload tracker, one period at a time.
 *
 * ONE endpoint, all three roles — the pattern the analytics route already uses.
 * An instructor's `self` scope narrows the grid to their own row rather than
 * being refused, so "My Report", the manager's team view and the admin's
 * university view are one implementation that cannot drift apart.
 *
 * Period resolution, in precedence order:
 *   ?from=&to=      explicit custom range
 *   ?month=YYYY-MM  that calendar month
 *   (nothing)       the CURRENT WEEK
 *
 * "Current" is resolved in the UNIVERSITY's timezone, never the server's — a
 * Kolkata tenant rolls into a new week before a UTC server does, and the report
 * must agree with the calendar on the wall where the work happened.
 */
export const GET = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  assertCanAccessUniversity(scope, params.id);

  const config = await loadUniversityConfig(params.id);
  const today = workDateFor(new Date(), config.timezone);
  const sp = req.nextUrl.searchParams;

  const fromParam = parseDateParam(sp.get("from"), "from");
  const toParam = parseDateParam(sp.get("to"), "to");
  const month = sp.get("month");

  let from: string;
  let to: string;

  if (fromParam || toParam) {
    if (!fromParam || !toParam) {
      throw new ApiError(400, "INVALID_PERIOD", "Provide both ?from= and ?to=, or neither");
    }
    from = fromParam.toISOString().slice(0, 10);
    to = toParam.toISOString().slice(0, 10);
    if (from > to) {
      throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`");
    }
    // A tracker renders one column per week; an unbounded range would render an
    // unusable grid and run one engine call per week to build it.
    const weeks = Math.ceil((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 604_800_000) + 1;
    if (weeks > 27) {
      throw new ApiError(400, "INVALID_PERIOD", "Range may not exceed 26 weeks");
    }
  } else if (month !== null) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new ApiError(400, "INVALID_MONTH", "month must be in YYYY-MM form");
    }
    ({ from, to } = monthBounds(month));
  } else {
    from = mondayOf(today);
    to = today > from ? today : from;
    // Always render the whole current week, not just up to today.
    to = from;
  }

  // A caller may narrow to one instructor for the per-person report. The id is
  // authorised against the SAME rule every other instructor-scoped route uses,
  // so this cannot become a way to read a colleague or another tenant: a
  // self-scoped caller asking for anyone but themselves gets 404, and the
  // requested instructor must belong to the university in the path.
  const requested = sp.get("instructorId");
  let instructorId = scope.kind === "self" ? scope.instructorId : undefined;
  if (requested) {
    const instructor = await prisma.instructor.findUnique({
      where: { id: requested },
      select: { id: true, universityId: true },
    });
    if (!instructor || instructor.universityId !== params.id) {
      throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    }
    assertCanReadInstructor(scope, instructor);
    instructorId = instructor.id;
  }

  // Manager-scoped reporting. `narrowManager` is the authority: an admin may
  // name any roster (or `unassigned`), a manager only their own, and an
  // instructor none at all. A manager who names nobody still gets their own
  // roster rather than the university's — the whole point of the relation.
  const managerFilter = narrowManager(scope, sp.get("managerId"));
  if (managerFilter.managerId) {
    // The roster must live in the university named in the path, or an admin
    // could read one tenant's manager through another tenant's URL.
    const manager = await prisma.manager.findUnique({
      where: { id: managerFilter.managerId },
      select: { id: true, universityId: true },
    });
    if (!manager || manager.universityId !== params.id) {
      throw new ApiError(404, "NOT_FOUND", "Manager not found");
    }
  }

  const tracker = await buildTracker({
    config,
    from,
    to,
    today,
    instructorId,
    ...("managerId" in managerFilter ? { managerId: managerFilter.managerId } : {}),
  });

  if (req.nextUrl.searchParams.get("export") !== "csv") {
    return NextResponse.json({ tracker });
  }

  // Exports are recorded events, like the workload report's — who exported
  // what, when, and how many rows.
  await logAudit(principal, scope, {
    action: "TRACKER_EXPORTED",
    entityType: "University",
    entityId: params.id,
    universityId: params.id,
    metadata: { from: tracker.from, to: tracker.to, rows: tracker.rows.length, format: "CSV" },
  });

  // The BOM must be in the BODY, written as an escape rather than a literal
  // character — the same reasoning as the workload export, where a literal
  // U+FEFF was silently stripped by source tooling.
  return new NextResponse("\uFEFF" + formatTrackerAsCsv(tracker), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tracker_${tracker.from}_to_${tracker.to}.csv"`,
    },
  });
});
