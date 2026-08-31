import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";
import { loadUniversityConfig } from "@/server/universities/config";
import { assertSelfMayWriteDay } from "@/server/worklog/window";
import { recordQuickEntry } from "@/server/worklog/quick-entry";
import { analyseDayInBackground } from "@/server/worklog/analysis";
import { QuickEntry, requireWritableInstructor } from "../route";
import { splitEntries } from "@/domain/worklog-entry-lines";

/**
 * Correcting one line of a day.
 *
 * Updated in place rather than deleted and re-created, so the row keeps its id
 * and its audit trail. The deliverable text is re-read for its category and
 * subject, because an edit can change what the line is about — correcting
 * "Build API" to "Build API and write the unit tests" should be allowed to move
 * the Broad Category with it.
 */
export const PATCH = withAuth<{ id: string; activityId: string }>(
  async ({ scope, params, req, principal }) => {
    const input = QuickEntry.parse(await req.json().catch(() => null));
    assertValidDate(input.date);

    const instructor = await requireWritableInstructor(scope, params.id);

    // Scoped by instructorId as well as id, so a row belonging to somebody else
    // cannot be reached even by guessing its id.
    const existing = await prisma.activityLog.findFirst({
      where: { id: params.activityId, instructorId: instructor.id },
      select: { id: true, workDate: true },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "That entry was not found.");

    /* Today only, for the instructor themselves — checked on BOTH dates.
     *
     * The date being saved TO is the obvious one. The row's existing date
     * matters just as much and is easy to miss: without it, a past day's entry
     * could be PATCHed with today's date, which passes a check that only looks
     * forward while quietly removing work from a day the same caller is not
     * allowed to touch. Two checks, because an edit spans two days whenever it
     * moves one. */
    const config = await loadUniversityConfig(instructor.universityId);
    assertSelfMayWriteDay({ scope, config, workDate: input.date });
    assertSelfMayWriteDay({
      scope,
      config,
      workDate: existing.workDate.toISOString().slice(0, 10),
    });

    /* An edit is ONE entry, always.
     *
     * The create route takes lists, because writing up a day is several things
     * at once. Correcting a row is not: splitting one row into three here would
     * have to decide which of them keeps the id, the audit trail and everything
     * pointing at it. So the same parser runs — the boxes look identical to the
     * instructor and "45m" must mean the same thing in both — and more than one
     * entry coming out of it is refused rather than resolved. */
    const split = splitEntries({
      deliverable: input.deliverable,
      quantity: input.quantity,
      workingHours: input.workingHours,
      remarks: input.remarks,
    });
    if (!split.ok) throw new ApiError(400, "ENTRY_LINES_INVALID", split.reason);
    if (split.entries.length > 1) {
      throw new ApiError(
        400,
        "EDIT_IS_ONE_ENTRY",
        `That describes ${split.entries.length} entries. Correct this one, then add the others separately.`,
      );
    }
    const entry = split.entries[0]!;

    const activity = await recordQuickEntry({
      instructorId: instructor.id,
      universityId: instructor.universityId,
      date: input.date,
      deliverable: entry.deliverable,
      quantity: entry.quantity,
      workingHours: entry.workingHours,
      remarks: entry.remarks,
      // The two boxes as typed, stored beside the parsed values so the
      // table can print what was written rather than what it parsed to.
      rawQuantity: entry.rawQuantity,
      rawWorkingHours: entry.rawWorkingHours,
      activityId: existing.id,
    });

    await logAudit(principal, scope, {
      action: "ACTIVITY_UPDATED",
      entityType: "ActivityLog",
      entityId: activity.id,
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id, via: "quick-entry" },
    });

    /* Re-read the day now that one of its entries has changed. Not awaited —
       an edit is somebody watching the screen, and the model belongs nowhere
       near that wait. See `analyseDayInBackground`. */
    analyseDayInBackground({
      instructorId: instructor.id,
      universityId: instructor.universityId,
      workDate: input.date,
    });

    return NextResponse.json({ activity });
  },
);
