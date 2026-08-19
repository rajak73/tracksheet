import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { updateActivity } from "@/server/activities/logger";
import { logAudit } from "@/server/audit/logger";
import { markReviewed } from "@/server/worklog/service";
import { createNotification } from "@/server/notifications/service";

/**
 * Correcting or removing one recorded activity.
 *
 * ── Who may, and why it is narrower than who may CREATE ────────────────────
 * Creating is open to anyone who can read the instructor, because a manager
 * legitimately logs work on somebody's behalf. Correcting and removing are
 * restricted to the record's SUBJECT and to an admin. A manager gaining the
 * ability to delete an instructor's recorded hours would let them change that
 * instructor's utilisation figure — the number they are themselves measured on
 * — and nothing in the product asks for it. An admin can still fix anything.
 *
 * ── The ledger, revisited honestly ─────────────────────────────────────────
 * `ActivityLog` was previously append-only, with no edit or delete route
 * anywhere. That was the right default while nothing could correct a mistake,
 * but it left an instructor who typed 14:00 instead of 04:00 with no recourse
 * and a permanently wrong utilisation figure. So correction exists now, and the
 * property that mattered is preserved differently: every edit and every removal
 * writes an audit row carrying what the record held BEFORE, so "what did this
 * say, and who changed it" is still answerable. The history moved from the
 * ledger's immutability to the audit trail, rather than being given up.
 *
 * ── Validation is not re-implemented here ──────────────────────────────────
 * The edit goes through the same writer as the original entry, so the interval
 * rules, the timezone resolution, the once-per-day rule, the overlap check and
 * the advisory lock all apply unchanged. A correction cannot produce a row the
 * original entry path would have refused.
 */

const EditActivity = z
  .object({
    activityTypeCode: z.string().min(1),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    local: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .optional(),
    status: z.enum(["COMPLETED", "MISSED", "LATE", "EXCUSED"]).optional(),
    remarks: z.string().max(2000).optional(),
    /* ── Corrections to what the parser decided (Phase 12) ────────────────
     * The instructor is fixing the AI's reading of their own sentence, so the
     * fields they can change are exactly the fields it produced. `null` clears
     * a deliverable the parser should not have chosen — a real answer, not an
     * omission, so it is distinguished from an absent field.
     */
    deliverableTypeCode: z.string().min(1).max(64).nullable().optional(),
    quantity: z.number().int().min(1).max(100).optional(),
  })
  .refine((v) => v.local !== undefined || (v.startTime !== undefined && v.endTime !== undefined), {
    message: "Provide either startTime/endTime or local {date, start, end}",
  });

type Params = { id: string; activityId: string };

/** Puts a refusal somewhere the instructor can still read it later. */
async function reportActivityFailure(
  activity: { instructorId: string; universityId: string },
  title: string,
  reason: string,
): Promise<void> {
  const row = await prisma.instructor
    .findUnique({ where: { id: activity.instructorId }, select: { userId: true } })
    .catch(() => null);
  if (!row) return;

  await createNotification({
    userId: row.userId,
    universityId: activity.universityId,
    type: "ACTIVITY_CHANGE_REFUSED",
    title,
    message: reason,
  }).catch(() => {});
}

/**
 * Loads the activity and decides whether this caller may change it.
 *
 * A 404 rather than a 403 when it belongs to somebody else: the caller has no
 * business knowing the id exists.
 */
async function loadOwned(scope: { kind: string; instructorId?: string }, params: Params) {
  const activity = await prisma.activityLog.findUnique({
    where: { id: params.activityId },
    select: {
      id: true,
      instructorId: true,
      universityId: true,
      workDate: true,
      startTime: true,
      endTime: true,
      remarks: true,
      submissionId: true,
      activityType: { select: { code: true } },
    },
  });

  if (!activity || activity.instructorId !== params.id) {
    throw new ApiError(404, "NOT_FOUND", "Activity not found");
  }

  if (scope.kind === "self") {
    if (scope.instructorId !== activity.instructorId) {
      throw new ApiError(404, "NOT_FOUND", "Activity not found");
    }
    return activity;
  }
  if (scope.kind === "global") return activity;

  throw new ApiError(
    403,
    "FORBIDDEN",
    "Only the instructor who recorded this activity, or an administrator, can change it.",
  );
}

export const PATCH = withAuth<Params>(async ({ scope, params, req, principal }) => {
  const activity = await loadOwned(scope, params);
  const input = EditActivity.parse(await req.json().catch(() => null));

  // A deliverable is resolved through the taxonomy rather than taken as an id,
  // so a request cannot attach one that does not exist — the same closed list
  // the parser is held to.
  let deliverableTypeId: string | null | undefined;
  if (input.deliverableTypeCode !== undefined) {
    if (input.deliverableTypeCode === null) {
      deliverableTypeId = null;
    } else {
      const deliverable = await prisma.deliverableType.findUnique({
        where: { code: input.deliverableTypeCode },
        select: { id: true, activityType: { select: { code: true } } },
      });
      if (!deliverable) {
        throw new ApiError(404, "DELIVERABLE_NOT_FOUND", "That deliverable does not exist.");
      }
      // It must belong to the category being saved, or the pairing would be one
      // the client's report has never contained.
      if (deliverable.activityType.code !== input.activityTypeCode) {
        throw new ApiError(
          400,
          "DELIVERABLE_CATEGORY_MISMATCH",
          "That deliverable belongs to a different category.",
        );
      }
      deliverableTypeId = deliverable.id;
    }
  }

  /* A refusal reaches the instructor through the bell.
   *
   * Their page reports problems there rather than in a panel beside the row,
   * so a correction that was refused — an overlap, a deliverable that belongs
   * to another category — is still readable after they have moved on. The
   * error is thrown as before; this only adds the copy that outlives it. */
  let updated;
  try {
    updated = await updateActivity(activity.id, {
      instructorId: activity.instructorId,
      universityId: activity.universityId,
      activityTypeCode: input.activityTypeCode,
      startTime: input.startTime ? new Date(input.startTime) : undefined,
      endTime: input.endTime ? new Date(input.endTime) : undefined,
      local: input.local,
      status: input.status,
      // An emptied box means "there is no detail here" — a real answer, and a
      // different one from "the field was not sent". Storing "" would leave a
      // cell that looks filled and reads as blank.
      remarks: input.remarks === undefined ? undefined : input.remarks.trim() || null,
      ...(deliverableTypeId !== undefined ? { deliverableTypeId } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      await reportActivityFailure(activity, "Your correction was not saved.", error.message);
    }
    throw error;
  }

  // Correcting a parsed entry IS the review. Recording it here, rather than
  // asking the instructor to press a separate "reviewed" button, is what makes
  // the three-hour escalation measure something real: whether anybody actually
  // looked at what the parser decided.
  if (activity.submissionId) await markReviewed(activity.submissionId);

  await logAudit(principal, scope, {
    action: "ACTIVITY_UPDATED",
    entityType: "ActivityLog",
    entityId: activity.id,
    universityId: activity.universityId,
    // The BEFORE state, so the change is reconstructable from the audit row
    // alone. This is what replaces the ledger's former immutability.
    metadata: {
      instructorId: activity.instructorId,
      before: {
        activityType: activity.activityType.code,
        startTime: activity.startTime.toISOString(),
        endTime: activity.endTime.toISOString(),
      },
      after: { activityType: input.activityTypeCode },
    },
  });

  return NextResponse.json({ activity: updated });
});

export const DELETE = withAuth<Params>(async ({ scope, params, principal }) => {
  const activity = await loadOwned(scope, params);

  try {
    await prisma.activityLog.delete({ where: { id: activity.id } });
  } catch (error) {
    await reportActivityFailure(
      activity,
      "That activity was not removed.",
      "Something went wrong while removing it. It is still on your day.",
    );
    throw error;
  }

  await logAudit(principal, scope, {
    action: "ACTIVITY_DELETED",
    entityType: "ActivityLog",
    entityId: activity.id,
    universityId: activity.universityId,
    // Everything the row held. A removal is the one case where the audit entry
    // is the only remaining record of what existed.
    metadata: {
      instructorId: activity.instructorId,
      removed: {
        activityType: activity.activityType.code,
        workDate: activity.workDate.toISOString().slice(0, 10),
        startTime: activity.startTime.toISOString(),
        endTime: activity.endTime.toISOString(),
        remarks: activity.remarks,
      },
    },
  });

  return NextResponse.json({ ok: true });
});
