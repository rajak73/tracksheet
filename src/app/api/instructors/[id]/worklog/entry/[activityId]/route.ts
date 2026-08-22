import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";
import { recordQuickEntry } from "@/server/worklog/quick-entry";
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
      select: { id: true },
    });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "That entry was not found.");

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
      activityId: existing.id,
    });

    await logAudit(principal, scope, {
      action: "ACTIVITY_UPDATED",
      entityType: "ActivityLog",
      entityId: activity.id,
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id, via: "quick-entry" },
    });

    return NextResponse.json({ activity });
  },
);
