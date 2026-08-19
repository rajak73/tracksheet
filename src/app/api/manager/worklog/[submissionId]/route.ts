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
        instructor: { select: { id: true, managerId: true } },
      },
    });
    if (!submission) throw new ApiError(404, "NOT_FOUND", "Worklog not found");

    // The roster this caller is allowed to decide for. A manager gets their own
    // id and cannot ask for another; an admin gets no filter.
    const roster = narrowManager(scope, null);
    if (roster.managerId && submission.instructor.managerId !== roster.managerId) {
      throw new ApiError(404, "NOT_FOUND", "Worklog not found");
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
