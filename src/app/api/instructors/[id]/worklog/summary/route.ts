import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { summariseDays } from "@/server/worklog/day-summary";

/**
 * One instructor's days, normalised for reading.
 *
 * ── What this returns and what it does not ────────────────────────────────
 * Names, labels and remarks come from the model; every FIGURE is summed on the
 * server from the activities themselves. The employee's name, their id and
 * their category are not here at all — the table takes those from the record,
 * because a report must not be able to disagree with the database about who it
 * is describing.
 *
 * A day the model could not be reached for still comes back, grouped by the
 * taxonomy's own labels. The figures are identical either way.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A month of days at a time. Longer is a report, not a screen. */
const MAX_RANGE_DAYS = 62;

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";

  if (!DAY.test(from) || !DAY.test(to)) {
    throw new ApiError(400, "INVALID_PERIOD", "Provide `from` and `to` as YYYY-MM-DD.");
  }
  // Shape is not a calendar: `2026-02-31` matches the pattern above.
  assertValidDate(from);
  assertValidDate(to);
  if (from > to) throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`.");

  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
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

  // A day's work is personal work: roster-level, like every other read of it.
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

  const days = await summariseDays(instructor.id, from, to);

  return NextResponse.json({ from, to, days: Object.fromEntries(days) });
});
