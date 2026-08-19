import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { createNotification } from "@/server/notifications/service";
import { logAudit } from "@/server/audit/logger";

/**
 * "You have not written up this day yet."
 *
 * ── A nudge, and nothing more ─────────────────────────────────────────────
 * This writes a notification. It creates no activity, changes no hours and
 * touches no submission — a manager who could fill in somebody else's timesheet
 * would make the record of who did what untrue, and the utilisation figure the
 * manager is themselves measured on is derived from that record.
 *
 * ── It refuses to nag about a day that is already in ──────────────────────
 * Checked against the rows rather than against what the caller's screen said,
 * because a dashboard can be a few minutes stale and "you have not submitted"
 * arriving after somebody just did is how people stop reading notifications.
 *
 * ── One per instructor per day ────────────────────────────────────────────
 * The dedupe key carries the date, so pressing the button twice — or two
 * managers pressing it — leaves one message rather than a pile.
 */

const Remind = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const POST = withAuth<{ id: string }>(
  async ({ scope, params, req, principal }) => {
    const input = Remind.parse(await req.json().catch(() => null));

    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        universityId: true,
        userId: true,
        user: { select: { isActive: true } },
      },
    });
    if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    assertCanReadInstructor(scope, instructor);

    if (!instructor.user.isActive) {
      throw new ApiError(400, "INSTRUCTOR_INACTIVE", "That instructor's account is deactivated.");
    }

    const already = await prisma.activityLog.count({
      where: {
        instructorId: instructor.id,
        workDate: new Date(`${input.workDate}T00:00:00.000Z`),
      },
    });
    if (already > 0) {
      throw new ApiError(
        409,
        "ALREADY_SUBMITTED",
        "That day is already recorded — there is nothing to remind them about.",
      );
    }

    await createNotification({
      userId: instructor.userId,
      universityId: instructor.universityId,
      type: "WORKLOG_REMINDER",
      title: "Your worklog is not in yet.",
      message: `Your manager is waiting on your worklog for ${input.workDate}. Write your day in your own words — it only takes a moment.`,
      dedupeKey: `worklog-reminder:${instructor.id}:${input.workDate}`,
    });

    await logAudit(principal, scope, {
      action: "WORKLOG_REMINDER_SENT",
      entityType: "Instructor",
      entityId: instructor.id,
      universityId: instructor.universityId,
      metadata: { workDate: input.workDate },
    });

    return NextResponse.json({ ok: true });
  },
  { roles: ["MANAGER", "ADMIN"] },
);
