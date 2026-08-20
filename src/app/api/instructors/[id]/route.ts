import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity, assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

export const GET = withAuth<{ id: string }>(async ({ scope, params }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      employeeCode: true,
      managerId: true,
      category: { select: { code: true, label: true } },
      // Read-only context for the instructor's own portal: they need to know
      // who they report to. Null is a real state — an admin may have removed
      // them from a roster — and is rendered as "Unassigned" rather than hidden.
      manager: {
        select: { id: true, employeeCode: true, user: { select: { name: true, email: true } } },
      },
      user: { select: { id: true, name: true, email: true, isActive: true } },
      university: {
        select: { id: true, name: true, slug: true, timezone: true, primaryManagerId: true },
      },
    },
  });

  if (!instructor) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Instructor not found" } },
      { status: 404 },
    );
  }

  // Throws 404 (not 403) when out of scope, so the endpoint cannot be used to
  // probe which instructor ids exist in other tenants.
  /* Roster-level, not tenant-level. A manager reaching an id off their roster
   * gets the same 404 an unknown id gets — see `assertCanReadInstructorWork`.
   * The staff directory and the university's manager list stay tenant-wide, so
   * "who else works here" is still answerable; "what did they do" is not. */
  assertCanReadInstructorWork(scope, instructor, instructor.university.primaryManagerId);

  return NextResponse.json({ instructor });
});

const EditInstructor = z.object({
  name: z.string().min(1).max(200).optional(),
  employeeCode: z.string().max(64).nullable().optional(),
  /* What this instructor teaches — Technical, English, Aptitude, Mathematics.
   * `null` clears it, which is a real answer ("nobody has decided") and is
   * therefore distinguished from the field being absent. Resolved by CODE, not
   * id, so a request cannot attach a category that does not exist. */
  categoryCode: z.string().min(1).max(64).nullable().optional(),
});

/**
 * Editing an instructor's profile.
 *
 * Deliberately narrow: name and employee code. Tenant, role and university
 * ownership are not editable — moving someone between universities would
 * invalidate every historical record that points at the old tenant. Manager
 * assignment keeps its own route (`PATCH .../manager`), because it is a
 * different decision with a different audit trail.
 *
 * An ADMIN may edit anyone in scope. A MANAGER may edit only the people who
 * actually report to them: the ownership check below compares the instructor's
 * `managerId` against the manager id the SESSION proves, never one the request
 * supplies, so a manager cannot reach a colleague's roster by guessing an id.
 */
export const PATCH = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = EditInstructor.parse(await req.json().catch(() => null));

    const instructor = await prisma.instructor.findUnique({
      where: { id: params.id },
      select: { id: true, universityId: true, managerId: true },
    });
    if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    assertCanAccessUniversity(scope, instructor.universityId);

    // A manager is confined to their own roster. 404 rather than 403: a manager
    // should not be able to confirm that another roster's instructor exists.
    if (scope.kind === "university" && instructor.managerId !== scope.managerId) {
      throw new ApiError(404, "NOT_FOUND", "Instructor not found");
    }

    if (input.employeeCode) {
      const clash = await prisma.instructor.findFirst({
        where: {
          universityId: instructor.universityId,
          employeeCode: input.employeeCode,
          NOT: { id: instructor.id },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ApiError(409, "EMPLOYEE_CODE_IN_USE", "That employee ID is already used here");
      }
    }

    let categoryId: string | null | undefined;
    if (input.categoryCode !== undefined) {
      if (input.categoryCode === null) {
        categoryId = null;
      } else {
        const category = await prisma.instructorCategory.findUnique({
          where: { code: input.categoryCode },
          select: { id: true, isActive: true },
        });
        if (!category || !category.isActive) {
          throw new ApiError(404, "CATEGORY_NOT_FOUND", "That category does not exist.");
        }
        categoryId = category.id;
      }
    }

    const updated = await prisma.instructor.update({
      where: { id: instructor.id },
      data: {
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        /* Through the RELATION rather than the raw column: the same update
         * also touches `user`, and Prisma will not mix a checked nested write
         * with an unchecked foreign key in one call. `disconnect` is how the
         * field is cleared. */
        ...(categoryId !== undefined
          ? {
              category:
                categoryId === null ? { disconnect: true } : { connect: { id: categoryId } },
            }
          : {}),
        ...(input.name ? { user: { update: { name: input.name } } } : {}),
      },
      select: {
        id: true,
        employeeCode: true,
        category: { select: { code: true, label: true } },
        user: { select: { name: true, email: true, isActive: true } },
      },
    });

    await logAudit(principal, scope, {
      action: "INSTRUCTOR_UPDATED",
      entityType: "Instructor",
      entityId: instructor.id,
      universityId: instructor.universityId,
      metadata: { fields: Object.keys(input) },
    });

    return NextResponse.json({ instructor: updated });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
