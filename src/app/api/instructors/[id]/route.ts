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
      // `category` is derived from their entries, not selected — see below.
      // Read-only context for the instructor's own portal: they need to know
      // who they report to. Null is a real state — an admin may have removed
      // them from a roster — and is rendered as "Unassigned" rather than hidden.
      manager: {
        select: { id: true, employeeCode: true, user: { select: { name: true, email: true } } },
      },
      // The Broad Category assigned to them — the value the client's report
      // prints, and the one an admin edits on this screen.
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

  /* Counted here rather than stored on the row. Reading it after the scope
   * check, not before, so an id the caller may not see costs no query. */
  return NextResponse.json({
    /* Two different questions, answered separately and named separately:
     * `category` is what somebody assigned them and is what the client's report
     * prints; `stream` is what their work over the last ninety days was mostly
     * about. They used to be conflated under one key, which is how a derived
     * value ended up in a column the client says must be supplied. */
    instructor,
  });
});

const EditInstructor = z.object({
  name: z.string().min(1).max(200).optional(),
  employeeCode: z.string().max(64).nullable().optional(),
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

    /* A code is resolved to a row before it is written, so an unknown one is a
     * 400 an admin can act on rather than a foreign-key error out of Prisma. */

    const updated = await prisma.instructor.update({
      where: { id: instructor.id },
      data: {
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.name ? { user: { update: { name: input.name } } } : {}),
      },
      select: {
        id: true,
        employeeCode: true,
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

    /* `category` is the ASSIGNED one — the value the report prints. The derived
     * stream comes back beside it under its own name, so a caller can show both
     * without either being mistaken for the other. */
    return NextResponse.json({
      instructor: updated,
    });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
