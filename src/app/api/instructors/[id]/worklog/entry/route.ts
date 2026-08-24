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
import { classifyLines, recordQuickEntry } from "@/server/worklog/quick-entry";
import { splitEntries } from "@/domain/worklog-entry-lines";

/**
 * One line of a day, from the four fields the form asks for.
 *
 * The screen this serves shows a Broad Category column it never asks about;
 * `recordQuickEntry` fills it by reading the deliverable text, and a day that
 * names no subject inherits from the last one that did. See that module.
 */

/**
 * The four boxes, as typed.
 *
 * ── Strings, not numbers, and the splitting happens on the server ─────────
 * The boxes take LISTS now — "Live Class, Doubt Session" against "2h, 45m" is
 * two entries — and where that list is cut decides which quantity lands on
 * which deliverable. That is not a decision to make in a browser and trust: it
 * is `splitEntries`, one function, and the form calls the same one only to show
 * a preview. What reaches the database is what the server split.
 *
 * `quantity` is a string for the same reason it is nullable elsewhere: an empty
 * box means nobody stated a count, which prints "?" and is a different answer
 * from zero. A number field cannot say that.
 */
export const QuickEntry = z.object({
  /** YYYY-MM-DD in the university's zone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliverable: z.string().min(1).max(4_000),
  /* A string or a number, either way.
   *
   * These became strings so a box can hold a LIST and so an empty quantity can
   * mean "nobody said" rather than zero. But callers that predate that send
   * numbers, and breaking them to tidy a type would be breaking a working API
   * for nothing — `splitEntries` reads "2" and 2 identically. */
  quantity: z
    .union([z.string().max(500), z.number()])
    .optional()
    .transform((v) => (v === undefined ? "" : String(v))),
  workingHours: z
    .union([z.string().min(1).max(500), z.number()])
    .transform((v) => String(v)),
  remarks: z
    .union([z.string().max(4_000), z.null()])
    .optional()
    .transform((v) => v ?? ""),
  /**
   * Rewrite the whole day rather than add to it.
   *
   * "Edit Today's Log" hands back every line of the day at once, so saving it
   * has to REPLACE what is there — appending would duplicate every line the
   * instructor did not touch. The client cannot do this in two requests: the
   * new entries are laid end to end after whatever the day already holds, so
   * writing before deleting pushes a full day past midnight and is refused,
   * and deleting before writing loses the day if the write then fails. One
   * request, one order, on the server.
   */
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
  const input = QuickEntry.parse(await req.json().catch(() => null));
  // Shape is not a calendar: `2026-02-31` matches the pattern above.
  assertValidDate(input.date);

  const instructor = await requireWritableInstructor(scope, params.id);
  /* An instructor records TODAY. The narrative box has always refused anything
   * else; this path never did, so the same day was writable here and refused
   * there. A manager or admin is unaffected — see `assertSelfMayWriteDay`. */
  assertSelfMayWriteDay({
    scope,
    config: await loadUniversityConfig(instructor.universityId),
    workDate: input.date,
  });

  const split = splitEntries({
    deliverable: input.deliverable,
    quantity: input.quantity,
    workingHours: input.workingHours,
    remarks: input.remarks,
  });
  if (!split.ok) throw new ApiError(400, "ENTRY_LINES_INVALID", split.reason);

  /* Cleared AFTER the lines parse and BEFORE any are written.
   *
   * After, so a request that was never going to succeed cannot empty a day on
   * its way to being refused. Before, so the new entries are placed against an
   * empty day — `recordQuickEntry` lays each one after whatever is already
   * there, and replacing eight hours with eight more would otherwise run the
   * day past midnight and be refused for it. */
  if (input.replace) {
    await prisma.activityLog.deleteMany({
      where: { instructorId: instructor.id, workDate: toDateOnly(input.date) },
    });
  }

  /* Written in order, one at a time, through the same writer a single entry
   * always used — so the interval limits, the once-per-day rule and the overlap
   * check under its advisory lock all apply to each of them.
   *
   * In order and not in parallel, deliberately: `recordQuickEntry` lays each
   * entry after whatever is already on the day, so the second has to see the
   * first. Racing them would put two activities at the same start time, and the
   * overlap rule would refuse one of the instructor's own lines. */
  // One provider call for the whole submission, not one per entry.
  const classifications = await classifyLines(split.entries);

  const activities = [];
  const refused: string[] = [];
  for (const [i, entry] of split.entries.entries()) {
    try {
      activities.push(
        await recordQuickEntry({
          instructorId: instructor.id,
          universityId: instructor.universityId,
          date: input.date,
          deliverable: entry.deliverable,
          quantity: entry.quantity,
          workingHours: entry.workingHours,
          remarks: entry.remarks,
          classification: classifications[i],
        }),
      );
    } catch (error) {
      /* One line refused — the day is full, or it overlaps something already
       * recorded — must not cost the instructor the others. What was written
       * stays written and the response says exactly which did not, because
       * silently recording four of five is the version they cannot see. */
      refused.push(
        `"${entry.deliverable}" — ${error instanceof ApiError ? error.message : "could not be recorded."}`,
      );
    }
  }

  if (activities.length === 0) {
    throw new ApiError(400, "NOTHING_RECORDED", refused.join(" "));
  }

  await logAudit(principal, scope, {
    action: "ACTIVITY_LOGGED",
    entityType: "ActivityLog",
    entityId: activities[0]!.id,
    universityId: instructor.universityId,
    metadata: { instructorId: instructor.id, via: "quick-entry", entries: activities.length },
  });

  // `activity` stays for callers that sent one and expect one back.
  return NextResponse.json(
    { activity: activities[0], activities, refused },
    { status: 201 },
  );
});
