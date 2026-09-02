import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";
import { loadUniversityConfig } from "@/server/universities/config";
import { assertSelfMayWriteDay } from "@/server/worklog/window";
import { parseWorkingMinutes } from "@/domain/worklog-hours";

/**
 * One day, saved.
 *
 * ── What this used to do ──────────────────────────────────────────────────
 * It split the four boxes into a list of activities, classified each one,
 * placed each on a clock so the day ran end to end from the university's
 * opening, checked the result for overlaps under an advisory lock, and wrote a
 * row per activity. A correction had to delete the whole day first, because
 * appending would have run it past midnight.
 *
 * All of that machinery existed to maintain a structure nobody had asked for.
 * The instructor writes four things; the row now holds four things. Structure is
 * derived afterwards by `DayExtraction`, where being wrong costs an insight
 * rather than a record.
 *
 * ── An upsert, so there is no such thing as a duplicate day ───────────────
 * The old shape allowed a day to exist twice and relied on the writer to
 * prevent it — which is how a correction silently doubled a day when the
 * `replace` flag was not sent. `(instructorId, logDate)` is unique in the
 * database now, and a save is an upsert, so a second save of the same day
 * REPLACES it because there is nowhere else for it to go.
 *
 * `replace` is therefore gone from the payload. It is still accepted and
 * ignored, so a client that has not been updated does not start failing.
 */

export const DayEntry = z.object({
  /** YYYY-MM-DD in the university's zone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** What they did, in their own words. */
  deliverable: z.string().min(1).max(8_000),
  /**
   * Free text, stored verbatim.
   *
   * "5 class", "2 batches", "half day" — context, not a measurement. A number
   * field could not hold most of what people actually write here, and coercing
   * it would replace their words with a parser's opinion of them.
   */
  /* The form no longer sends this. The two boxes were merged into one and the
     day's work is written a line at a time, with counts inline — see the note
     above the textarea on the instructor's page. Still ACCEPTED, and still
     optional, so anything mid-flight during the rollout saves rather than
     erroring; absent becomes null, which is what new days now store. */
  quantity: z
    .union([z.string().max(1_000), z.number(), z.null()])
    .optional()
    .transform((v) => (v === undefined || v === null ? "" : String(v))),
  /** The day's total. Accepts what people type: "8", "8.5", "8h 30m", "6 hours". */
  workingHours: z.union([z.string().min(1).max(200), z.number()]).transform((v) => String(v)),
  remarks: z
    .union([z.string().max(8_000), z.null()])
    .optional()
    .transform((v) => v ?? ""),
  /** Accepted and ignored — see the note above. */
  replace: z.boolean().optional(),
});

/** Resolves the instructor and authorises writing to them. */
export async function requireWritableInstructor(
  scope: Parameters<typeof assertCanManageInstructor>[0],
  instructorId: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  // Recording somebody's hours is a write, so the roster decides — the same
  // check every other write on this sub-tree uses.
  assertCanManageInstructor(scope, instructor, instructor.university.primaryManagerId);
  return instructor;
}

export const POST = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  const input = DayEntry.parse(await req.json().catch(() => null));
  // Shape is not a calendar: `2026-02-31` matches the pattern above.
  assertValidDate(input.date);

  const instructor = await requireWritableInstructor(scope, params.id);
  /* An instructor may write any day that has happened; the future is refused.
   * A manager or admin is unaffected — see `assertSelfMayWriteDay`. */
  assertSelfMayWriteDay({
    scope,
    config: await loadUniversityConfig(instructor.universityId),
    workDate: input.date,
  });

  const minutes = parseWorkingMinutes(input.workingHours);
  if (minutes === null) {
    throw new ApiError(
      400,
      "INVALID_WORKING_HOURS",
      `"${input.workingHours}" is not a length of time. Try 8, 8.5, 8h 30m, or 6 hours.`,
    );
  }
  if (minutes > 24 * 60) {
    throw new ApiError(400, "INVALID_WORKING_HOURS", `"${input.workingHours}" is longer than a day.`);
  }

  const deliverable = input.deliverable.trim();
  if (deliverable === "") throw new ApiError(400, "NOTHING_RECORDED", "Say what you worked on.");

  const data = {
    deliverable,
    // Blank normalises to null so "wrote nothing" is one value rather than two.
    deliverableQuantity: input.quantity.trim() || null,
    workingMinutes: minutes,
    remarks: input.remarks.trim() || null,
  };

  const entry = await prisma.worklogEntry.upsert({
    where: {
      instructorId_logDate: { instructorId: instructor.id, logDate: toDateOnly(input.date) },
    },
    create: {
      instructorId: instructor.id,
      universityId: instructor.universityId,
      logDate: toDateOnly(input.date),
      ...data,
    },
    update: {
      ...data,
      /* Once somebody saves a day themselves, the text is theirs.
       *
       * `source` describes where the WORDS came from, and a day that was
       * reconstructed from the old taxonomy and has since been rewritten is no
       * longer reconstructed. Leaving it MIGRATED would put the provenance note
       * on the instructor's own sentence — telling a reader that what they are
       * looking at came from a machine when it did not, which is the one thing
       * the column exists to avoid. */
      source: "NATIVE" as const,
    },
  });

  await logAudit(principal, scope, {
    action: "ACTIVITY_LOGGED",
    entityType: "WorklogEntry",
    entityId: entry.id,
    universityId: instructor.universityId,
    metadata: { instructorId: instructor.id, logDate: input.date },
  });

  /* Nothing is invalidated here, deliberately. The insight cache compares a hash
     of this day's content on the next view, so a write that changes nothing
     costs nothing and a write that changes something is noticed without anybody
     having to remember to say so. */
  return NextResponse.json({ entry }, { status: 201 });
});

/**
 * Removes a whole day.
 *
 * A day is the unit now, so there is no per-activity delete and no route that
 * takes an activity id — that whole endpoint is gone. Correcting a day means
 * saving it again; removing it means this.
 *
 * Idempotent: deleting a day that is not there is a success, because the caller
 * asked for it to be absent and it is. A 404 would only tell somebody clicking
 * Delete twice that they had done something wrong.
 */
export const DELETE = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  assertValidDate(date);

  const instructor = await requireWritableInstructor(scope, params.id);
  assertSelfMayWriteDay({
    scope,
    config: await loadUniversityConfig(instructor.universityId),
    workDate: date,
  });

  const removed = await prisma.worklogEntry.deleteMany({
    where: { instructorId: instructor.id, logDate: toDateOnly(date) },
  });

  if (removed.count > 0) {
    await logAudit(principal, scope, {
      action: "ACTIVITY_DELETED",
      entityType: "WorklogEntry",
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id, logDate: date },
    });
  }

  /* The day's extraction goes with it. An extraction of a day that no longer
     exists is a reading of nothing, and leaving it would let a later insight be
     assembled from work that has been removed. The insight cache needs no such
     sweep: its hash stops matching by itself. */
  await prisma.dayExtraction.deleteMany({
    where: { instructorId: instructor.id, logDate: toDateOnly(date) },
  });

  return NextResponse.json({ ok: true, removed: removed.count });
});
