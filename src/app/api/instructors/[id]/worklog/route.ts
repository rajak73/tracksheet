import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { createNotification } from "@/server/notifications/service";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { assertValidDate } from "@/server/time/schedule-windows";
import { logAudit } from "@/server/audit/logger";
import { MAX_BULLETS, MAX_BULLET_CHARS, submitWorklog } from "@/server/worklog/service";

/**
 * Submitting a day's worklog as free text, and reading back what came of it.
 *
 * ── Submission returns before parsing ──────────────────────────────────────
 * POST answers as soon as the instructor's sentences are SAVED, not when they
 * have been understood. That is the point: a provider outage must cost a
 * parse, never a day's typing. The response says so — `status: "PENDING"` —
 * and the client polls or waits for the notification.
 *
 * ── Scope ──────────────────────────────────────────────────────────────────
 * READING uses `assertCanReadInstructor`, the same check the activity routes
 * use: an instructor reaches only themselves, a manager their own university.
 *
 * WRITING does NOT. A submission is the instructor's own words, and posting one
 * supersedes whatever they last wrote for that day and deletes the activities
 * it produced. `assertCanReadInstructor` compares only `universityId` for a
 * manager, so it would have let any manager in the tenant overwrite any
 * instructor's day — including one on nobody else's roster — and store their
 * text as that person's own. So POST is self-or-admin, matching the sibling
 * write routes (`worklog/notes`, `activities/[activityId]`).
 */

const SubmitWorklog = z.object({
  /** YYYY-MM-DD in the university's zone. */
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bullets: z.array(z.string().max(MAX_BULLET_CHARS)).min(1).max(MAX_BULLETS),
});

/** One place the refusal reasons become something an instructor can re-read. */
async function reportSubmitFailure(
  instructor: { id: string; universityId: string },
  workDate: string,
  reason: string,
): Promise<void> {
  const row = await prisma.instructor
    .findUnique({ where: { id: instructor.id }, select: { userId: true } })
    .catch(() => null);
  if (!row) return;

  await createNotification({
    userId: row.userId,
    universityId: instructor.universityId,
    type: "WORKLOG_REJECTED",
    title: "Your worklog was not submitted.",
    message: `${reason} Nothing was saved for ${workDate}.`,
    dedupeKey: `worklog-failed:${instructor.id}:${workDate}`,
  }).catch(() => {});
}

export const POST = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  const input = SubmitWorklog.parse(await req.json().catch(() => null));

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

  /* Self or admin only — see the note at the top of this file. A worklog is a
   * statement in the first person, and it destroys the day it replaces, so
   * "may read this instructor" is the wrong question to ask of it. */
  if (scope.kind === "self") {
    if (scope.instructorId !== instructor.id) {
      throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    }
  } else if (scope.kind !== "global") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the instructor whose day this is, or an administrator, can submit it.",
    );
  }

  /* A refusal is reported through the bell, not only through the response.
   *
   * The instructor's page deliberately carries no error panel any more, so
   * "why did nothing save?" has to be answerable from the notification list
   * minutes later rather than from whatever was on screen at the time. The
   * error is still thrown — the caller gets its 400 — this only adds the copy
   * that outlives the request.
   */
  let submission;
  try {
    submission = await submitWorklog({
      instructorId: instructor.id,
      universityId: instructor.universityId,
      workDate: input.workDate,
      bullets: input.bullets,
    });
  } catch (error) {
    // `submitWorklog` already reports the wrong-day refusal itself, with the
    // date in hand. Anything else is reported here rather than twice.
    if (error instanceof ApiError && error.code !== "WORKLOG_DATE_NOT_ALLOWED") {
      await reportSubmitFailure(instructor, input.workDate, error.message);
    }
    throw error;
  }

  await logAudit(principal, scope, {
    action: "WORKLOG_SUBMITTED",
    entityType: "WorklogSubmission",
    entityId: submission.id,
    universityId: instructor.universityId,
    // The count, never the sentences: an instructor's own notes about their day
    // are not something the audit trail needs a second copy of.
    metadata: { instructorId: instructor.id, workDate: input.workDate, bullets: submission.bulletCount },
  });

  return NextResponse.json({ submission }, { status: 202 });
});

/**
 * A day's submissions, with the raw text beside what was parsed from it.
 *
 * This is what the review view reads. Both halves come back together and are
 * joined by `rawText` on each row — never two requests that could disagree
 * about which sentence produced which activity.
 */
export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(400, "INVALID_DATE", "Provide `date` as YYYY-MM-DD.");
  }
  // The pattern is shape only; 2026-13-45 would reach Prisma as Invalid Date.
  assertValidDate(date);

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
  /* Roster-level, not tenant-level: this returns the instructor's own work, and
   * a manager's reach over that is their roster. See the note on
   * `assertCanReadInstructorWork`. An off-roster id answers 404, exactly as an
   * unknown one does. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

  const submissions = await prisma.worklogSubmission.findMany({
    where: {
      instructorId: instructor.id,
      workDate: new Date(`${date}T00:00:00.000Z`),
      // A day that has been rewritten shows what it says NOW.
      supersededAt: null,
    },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true,
      status: true,
      parseError: true,
      rejections: true,
      rawBullets: true,
      submittedAt: true,
      parsedAt: true,
      reviewedAt: true,
      escalatedAt: true,
      needsReview: true,
      approval: true,
      exceptionReason: true,
      decisionNote: true,
      activities: {
        orderBy: { startTime: "asc" },
        select: {
          id: true,
          rawText: true,
          startTime: true,
          endTime: true,
          quantity: true,
          remarks: true,
          activityType: { select: { code: true, label: true } },
          deliverableType: { select: { code: true, label: true, isCountable: true } },
        broadCategory: { select: { code: true, label: true } },
        },
      },
    },
  });

  return NextResponse.json({
    date,
    submissions: submissions.map((s) => ({
      ...s,
      rawBullets: Array.isArray(s.rawBullets) ? (s.rawBullets as string[]) : [],
    })),
  });
});
