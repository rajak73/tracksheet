import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";

/**
 * The instructor's own note about a day.
 *
 * ── Written by the person, never derived ──────────────────────────────────
 * "All planned sessions completed" is a judgement about how the day went, and
 * the only honest source for it is the person who lived it. Nothing here reads
 * the activities to compose one — a column that filled itself would be putting
 * words in somebody's mouth in the report their manager signs off.
 *
 * ── Only they may write it ────────────────────────────────────────────────
 * Reading follows the ordinary instructor-scope rule, so a manager or an admin
 * can see it. WRITING is restricted to the instructor themselves and to an
 * admin, the same line the activity-correction route draws: a manager putting
 * words into an instructor's remarks column would make the record of who said
 * what untrue.
 *
 * ── Any day, not only today ───────────────────────────────────────────────
 * Unlike the worklog itself, which may only describe today, a note may be
 * added to a past day. It records an opinion rather than a claim about hours,
 * so it cannot inflate anybody's time, and "I meant to say the lab overran"
 * is a reasonable thing to want the day after.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const SaveNote = z.object({
  workDate: z.string().regex(DAY),
  /** Empty clears it — a real answer, not an omission. */
  note: z.string().max(2000),
});

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
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
  /* Roster-level, not tenant-level: this reports an individual's work, and a
   * manager's reach over that is their roster. An off-roster id answers 404,
   * exactly as an unknown one does — see `assertCanReadInstructorWork`. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to || !DAY.test(from) || !DAY.test(to)) {
    throw new ApiError(400, "INVALID_PERIOD", "Provide `from` and `to` as YYYY-MM-DD.");
  }
  // Shape is not reality: the pattern accepts 2026-13-45, which becomes an
  // Invalid Date and fails inside Prisma as a 500 rather than a 400.
  assertValidDate(from);
  assertValidDate(to);

  const notes = await prisma.worklogDayNote.findMany({
    where: {
      instructorId: instructor.id,
      workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
    },
    select: { workDate: true, note: true },
  });

  // Keyed by date, because every caller wants "what did they say about the 19th"
  // rather than a list to search.
  return NextResponse.json({
    notes: Object.fromEntries(notes.map((n) => [n.workDate.toISOString().slice(0, 10), n.note])),
  });
});

export const PATCH = withAuth<{ id: string }>(async ({ scope, params, req, principal }) => {
  const input = SaveNote.parse(await req.json().catch(() => null));
  assertValidDate(input.workDate);

  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: { id: true, universityId: true },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");

  if (scope.kind === "self") {
    if (scope.instructorId !== instructor.id) {
      throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    }
  } else if (scope.kind !== "global") {
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only the instructor whose day this is, or an administrator, can write this note.",
    );
  }

  const workDate = new Date(`${input.workDate}T00:00:00.000Z`);
  const note = input.note.trim();

  if (note === "") {
    // Cleared is a real answer: the row goes rather than holding an empty string
    // that reads as "written, and blank".
    await prisma.worklogDayNote.deleteMany({ where: { instructorId: instructor.id, workDate } });
  } else {
    await prisma.worklogDayNote.upsert({
      where: { instructorId_workDate: { instructorId: instructor.id, workDate } },
      update: { note },
      create: { instructorId: instructor.id, universityId: instructor.universityId, workDate, note },
    });
  }

  await logAudit(principal, scope, {
    action: "WORKLOG_DAY_NOTE_SAVED",
    entityType: "Instructor",
    entityId: instructor.id,
    universityId: instructor.universityId,
    // The date and whether anything is there — never the words themselves.
    metadata: { workDate: input.workDate, cleared: note === "" },
  });

  return NextResponse.json({ note: note === "" ? null : note });
});
