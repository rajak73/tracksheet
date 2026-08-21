import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { daySubjectsFor } from "@/server/instructors/day-subject";
import { loadUniversityConfig } from "@/server/universities/config";
import { assertValidDate } from "@/server/time/schedule-windows";

/**
 * What each of this instructor's office days was about.
 *
 * ── Why this is its own route ─────────────────────────────────────────────
 * The instructor's sheet prints a "Broad Category" column, and the manager's
 * sheet prints the same column for the same days. They have to agree, and the
 * answer is not derivable in the browser: a day with no class of its own
 * inherits the subject of the last office day that had one, and that day is
 * usually outside the window on screen.
 *
 * The manager's side gets it from `/api/manager/worklog`, which already returns
 * a roster. An instructor reads their own days through `/api/activities`, which
 * is a general explorer over every scope and has no business growing a
 * per-instructor derived column. Hence a small route that answers exactly this
 * question.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A sheet shows a month at most; the carry-forward reads further back itself. */
const MAX_RANGE_DAYS = 62;

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  if (!DAY.test(from) || !DAY.test(to)) {
    throw new ApiError(400, "INVALID_PERIOD", "Provide `from` and `to` as YYYY-MM-DD.");
  }
  // Shape is not a calendar. `2026-02-31` matches the regex and rolls over into
  // March, which would silently answer a different question than was asked.
  assertValidDate(from);
  assertValidDate(to);
  if (from > to) {
    throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`.");
  }
  const span =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (span > MAX_RANGE_DAYS) {
    throw new ApiError(400, "RANGE_TOO_WIDE", `Ask for at most ${MAX_RANGE_DAYS} days at a time.`);
  }

  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");

  // Roster-level, like every other read of an individual's work.
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

  const config = await loadUniversityConfig(instructor.universityId);
  const byDate = await daySubjectsFor([instructor.id], from, to, config);

  return NextResponse.json({
    from,
    to,
    subjectByDate: Object.fromEntries(byDate.get(instructor.id) ?? []),
  });
});
