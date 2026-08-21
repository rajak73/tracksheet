import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanManageInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { assertValidDate } from "@/server/time/schedule-windows";
import { recordQuickEntry } from "@/server/worklog/quick-entry";

/**
 * One line of a day, from the four fields the form asks for.
 *
 * The screen this serves shows a Broad Category column it never asks about;
 * `recordQuickEntry` fills it by reading the deliverable text, and a day that
 * names no subject inherits from the last one that did. See that module.
 */

export const QuickEntry = z.object({
  /** YYYY-MM-DD in the university's zone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliverable: z.string().min(1).max(500),
  /** Whole units of the deliverable. Zero is a real answer for unmeasured work. */
  quantity: z.number().int().min(0).max(10_000),
  workingHours: z.number().positive().max(24),
  remarks: z.string().max(500).nullable().optional(),
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

  const activity = await recordQuickEntry({
    instructorId: instructor.id,
    universityId: instructor.universityId,
    date: input.date,
    deliverable: input.deliverable,
    quantity: input.quantity,
    workingHours: input.workingHours,
    remarks: input.remarks ?? null,
  });

  await logAudit(principal, scope, {
    action: "ACTIVITY_LOGGED",
    entityType: "ActivityLog",
    entityId: activity.id,
    universityId: instructor.universityId,
    metadata: { instructorId: instructor.id, via: "quick-entry" },
  });

  return NextResponse.json({ activity }, { status: 201 });
});
