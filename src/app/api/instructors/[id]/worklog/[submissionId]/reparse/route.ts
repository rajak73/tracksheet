import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { runParse } from "@/server/worklog/service";

/**
 * Reading a saved submission again.
 *
 * Exists because a failed parse is a provider problem, not a data problem — the
 * sentences are already stored, and the only thing missing is another attempt.
 * Without this an instructor whose submission landed during an outage would
 * have to retype a day they already typed.
 *
 * Only a submission that has NOT been parsed can be re-read. Re-running a
 * successful one would write the same activities a second time; correcting a
 * parsed entry is a different action with its own route.
 */
export const POST = withAuth<{ id: string; submissionId: string }>(
  async ({ scope, params }) => {
    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id },
      select: { id: true, universityId: true },
    });
    if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    assertCanReadInstructor(scope, instructor);

    const submission = await prisma.worklogSubmission.findUnique({
      where: { id: params.submissionId },
      select: { id: true, instructorId: true, status: true, supersededAt: true },
    });
    if (!submission || submission.instructorId !== instructor.id) {
      throw new ApiError(404, "NOT_FOUND", "Submission not found");
    }
    /* Withdrawn. A FAILED submission the instructor has since rewritten still
     * looks re-readable to a stale tab, and re-reading it would write the
     * WITHDRAWN text's activities onto a day the replacement already owns —
     * hanging off a submission the day view hides, so the hours would appear
     * with nothing on screen to explain them. */
    if (submission.supersededAt) {
      throw new ApiError(
        409,
        "SUPERSEDED",
        "You have since rewritten this day. There is nothing left to read here.",
      );
    }
    if (submission.status === "PARSED") {
      throw new ApiError(
        409,
        "ALREADY_PARSED",
        "This worklog has already been read. Correct an entry instead of reading it again.",
      );
    }

    await prisma.worklogSubmission.update({
      where: { id: submission.id },
      data: { status: "PENDING", parseError: null },
    });

    // Not awaited, for the same reason submission is not: reading is slow and
    // the answer is a notification, not a response body.
    void runParse(submission.id);

    return NextResponse.json({ started: true }, { status: 202 });
  },
);
