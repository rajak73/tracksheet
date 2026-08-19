import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

/**
 * Assigning an instructor to a manager — and unassigning them again.
 *
 * ── Who may do what ────────────────────────────────────────────────────────
 * ADMIN assigns, reassigns and unassigns anyone in scope. A MANAGER may do
 * exactly one thing: remove someone from THEIR OWN roster, by setting
 * `managerId: null`. They cannot assign to another manager, cannot claim
 * someone else's instructor, and cannot assign to themselves — otherwise a
 * manager could quietly take over a colleague's team, which is the boundary
 * this relation exists to draw.
 *
 * "Remove" is an unassignment, never a deletion. The instructor row, their
 * activity history, deliverables and audit trail all survive untouched; only
 * the pointer to a manager is cleared, and the admin then sees them as
 * unassigned. The route writes ONE column and nothing else.
 *
 * Cross-tenant safety is not enforced here. It is enforced by the composite
 * foreign key `(managerId, universityId) → Manager(id, universityId)`, so an
 * instructor whose manager belongs to another university is rejected by
 * PostgreSQL whatever this code does. The check below exists to turn that into
 * a readable 422 instead of a driver error — it is the message, not the guard.
 */
const Body = z.object({
  // Explicit null unassigns. `undefined` is rejected: silently doing nothing on
  // a malformed body is how an "assignment" appears to succeed and does not.
  managerId: z.string().min(1).nullable(),
});

export const PATCH = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = Body.parse(await req.json().catch(() => null));

    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        universityId: true,
        managerId: true,
        employeeCode: true,
        user: { select: { name: true } },
      },
    });
    if (!instructor) {
      throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    }

    if (scope.kind === "university") {
      // Order matters. "A manager may never assign" is checked FIRST, so the
      // refusal is always the honest one — 403, this is not your action —
      // whoever the instructor happens to belong to. Checking ownership first
      // would answer an attempted assignment with 404, which reads as "no such
      // person" and hides the real rule.
      if (input.managerId !== null) {
        throw new ApiError(
          403,
          "ASSIGNMENT_IS_ADMIN_ONLY",
          "You can remove an instructor from your roster; assigning them is an admin action",
        );
      }
      // Removal is theirs to do, but only for their own people. 404 here so a
      // manager cannot use this route to confirm another roster's id is real.
      if (instructor.managerId !== scope.managerId) {
        throw new ApiError(404, "NOT_FOUND", "Instructor not found");
      }
    }

    let manager: { id: string; universityId: string; user: { name: string; isActive: boolean } } | null =
      null;

    if (input.managerId) {
      manager = await prisma.manager.findUnique({
        where: { id: input.managerId },
        select: {
          id: true,
          universityId: true,
          user: { select: { name: true, isActive: true } },
        },
      });
      if (!manager) {
        throw new ApiError(404, "MANAGER_NOT_FOUND", "Manager not found");
      }
      if (manager.universityId !== instructor.universityId) {
        // The database would refuse this anyway; refusing it here says why.
        throw new ApiError(
          422,
          "CROSS_TENANT_ASSIGNMENT",
          "A manager can only lead instructors in their own university",
        );
      }
      if (!manager.user.isActive) {
        // Assigning people to someone who can no longer sign in produces a
        // roster nobody is reading.
        throw new ApiError(
          422,
          "MANAGER_INACTIVE",
          "That manager is deactivated. Reactivate them, or choose another.",
        );
      }
    }

    // Idempotent: re-sending the current value is a success, not a write.
    if (instructor.managerId === input.managerId) {
      return NextResponse.json({
        instructor: {
          id: instructor.id,
          managerId: instructor.managerId,
          unchanged: true,
        },
      });
    }

    const updated = await prisma.instructor.update({
      where: { id: instructor.id },
      data: { managerId: input.managerId },
      select: {
        id: true,
        managerId: true,
        manager: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
      },
    });

    await logAudit(principal, scope, {
      action: input.managerId ? "INSTRUCTOR_MANAGER_ASSIGNED" : "INSTRUCTOR_MANAGER_UNASSIGNED",
      entityType: "Instructor",
      entityId: instructor.id,
      universityId: instructor.universityId,
      metadata: {
        instructorName: instructor.user.name,
        employeeCode: instructor.employeeCode,
        from: instructor.managerId,
        to: input.managerId,
        managerName: manager?.user.name ?? null,
      },
    });

    return NextResponse.json({
      instructor: {
        id: updated.id,
        managerId: updated.managerId,
        manager: updated.manager
          ? {
              id: updated.manager.id,
              employeeCode: updated.manager.employeeCode,
              name: updated.manager.user.name,
            }
          : null,
        unchanged: false,
      },
    });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
