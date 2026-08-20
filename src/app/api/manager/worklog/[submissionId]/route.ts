import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { narrowManager } from "@/server/auth/scope";
import { decideSubmission } from "@/server/worklog/service";
import { logAudit } from "@/server/audit/logger";

/**
 * A manager deciding a worklog that was held.
 *
 * ── Why this route has to exist ───────────────────────────────────────────
 * Work outside the university's hours is held rather than refused: people stay
 * late, and a rule that threw the day away would be worse than one that asks.
 * But `decideSubmission` had no route, so "asks" meant "waits forever" — an
 * instructor's edit vanished into a queue nobody could open, and the day looked
 * to them as though the product had ignored it.
 *
 * ── Approval is what WRITES the activities ────────────────────────────────
 * Nothing was recorded while the request was open, so a refusal leaves no trace
 * in anybody's hours and an approval is the first time those rows exist. That
 * ordering is the whole reason a held day cannot quietly inflate a figure.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 * `narrowManager` pins a manager to their own roster, and the submission's
 * instructor is checked against it — naming somebody else's instructor gets a
 * 404 rather than a 403, because the id is not theirs to confirm.
 */

const Decide = z.object({
  approve: z.boolean(),
  note: z.string().max(2000).optional(),
});

export const PATCH = withAuth<{ submissionId: string }>(
  async ({ scope, params, req, principal }) => {
    const input = Decide.parse(await req.json().catch(() => null));

    const submission = await prisma.worklogSubmission.findUnique({
      where: { id: params.submissionId },
      select: {
        id: true,
        universityId: true,
        approval: true,
        instructor: {
          select: {
            id: true,
            managerId: true,
            // For the primary-manager stand-in below.
            university: { select: { primaryManagerId: true } },
          },
        },
      },
    });
    if (!submission) throw new ApiError(404, "NOT_FOUND", "Worklog not found");

    /* The roster this caller is allowed to decide for. A manager gets their own
     * id and cannot ask for another; an admin gets no filter.
     *
     * ── The unassigned belong to the primary manager, here too ────────────
     * The QUEUE at `GET /api/manager/worklog` shows a university's primary
     * manager the held days of instructors on nobody's roster — that is what
     * `answersForUnassigned` means there, and the notification for such a day
     * is addressed to them. This route had no matching clause, so the item
     * appeared in their queue, the bell told them to action it, and pressing
     * approve answered 404.
     *
     * That is worse than an inconsistent boundary. `decideSubmission` is what
     * WRITES the activities, so nobody below an admin could record that day at
     * all: the instructor's hours were simply never counted, and the only
     * person told about it was told it was theirs to fix.
     *
     * Same rule as `assertCanManageInstructor` — mine, or unassigned and I am
     * the primary. Spelled out rather than delegated because this route answers
     * 404 for an off-roster submission, and that is right: a submission id the
     * caller may not decide should look like an id that does not exist. */
    const roster = narrowManager(scope, null);
    if (roster.managerId) {
      const mine = submission.instructor.managerId === roster.managerId;
      const primaryManagerId = submission.instructor.university.primaryManagerId;
      const unassignedAndIAmPrimary =
        submission.instructor.managerId === null &&
        primaryManagerId != null &&
        primaryManagerId === roster.managerId;

      if (!mine && !unassignedAndIAmPrimary) {
        throw new ApiError(404, "NOT_FOUND", "Worklog not found");
      }
    }

    const decided = await decideSubmission({
      submissionId: submission.id,
      approve: input.approve,
      decidedById: principal.userId,
      note: input.note,
    });

    await logAudit(principal, scope, {
      action: input.approve ? "WORKLOG_APPROVED" : "WORKLOG_REJECTED",
      entityType: "WorklogSubmission",
      entityId: submission.id,
      universityId: submission.universityId,
      metadata: {
        instructorId: submission.instructor.id,
        // The count, never the sentences: an instructor's own notes are not
        // something the audit trail needs a second copy of.
        activitiesWritten: decided.written,
      },
    });

    return NextResponse.json({ decision: decided });
  },
  { roles: ["MANAGER", "ADMIN"] },
);
