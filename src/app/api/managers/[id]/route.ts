import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

/**
 * One manager, by id.
 *
 * The manager drill-down needs to know which university a manager belongs to
 * before it can ask for anything else, and a manager with an empty roster has
 * no instructor to infer it from. That is the whole job of this route.
 *
 * A manager may read themselves — the page is theirs too — but the tenant check
 * is the same one every other university-scoped route uses, so one manager
 * cannot read a manager in another university.
 */
export const GET = withAuth<{ id: string }>(
  async ({ params, scope }) => {
    const manager = await prisma.manager.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        employeeCode: true,
        universityId: true,
        user: { select: { name: true, email: true, isActive: true } },
        university: { select: { id: true, name: true, code: true } },
      },
    });

    // 404 rather than 403 for an unknown id, so this cannot be used to probe
    // which manager ids exist in other tenants.
    if (!manager) throw new ApiError(404, "NOT_FOUND", "Manager not found");
    assertCanAccessUniversity(scope, manager.universityId);

    /* The tenant check is not sufficient here. It answers "may you touch this
     * university", and a manager's colleagues are inside it — so on its own it
     * handed one manager a peer's name, email, employee code, primary flag and
     * roster size. The LIST route already refuses that same request through
     * `narrowManagerRow`; asking for `?managerId=N` there returns 403 while
     * asking for `/managers/N` here returned the record. One boundary, two
     * answers, is not a boundary. */
    if (scope.kind === "university" && scope.managerId !== manager.id) {
      throw new ApiError(403, "CROSS_MANAGER_DENIED", "That manager is not you");
    }

    const [instructorCount, primary] = await Promise.all([
      prisma.instructor.count({
        where: { managerId: manager.id, user: { isActive: true } },
      }),
      prisma.university.findUnique({
        where: { id: manager.universityId },
        select: { primaryManagerId: true },
      }),
    ]);

    return NextResponse.json({
      manager: {
        id: manager.id,
        employeeCode: manager.employeeCode,
        universityId: manager.universityId,
        university: manager.university,
        user: manager.user,
        isPrimary: primary?.primaryManagerId === manager.id,
        instructorCount,
      },
    });
  },
  { roles: ["ADMIN", "MANAGER"] },
);

const EditManager = z.object({
  name: z.string().min(1).max(200).optional(),
  // Explicit null clears the code; omitting the key leaves it alone.
  employeeCode: z.string().max(64).nullable().optional(),
});

/**
 * Editing a manager's profile.
 *
 * ADMIN only, and deliberately narrow: name and employee code, nothing else.
 * University ownership, role and tenant are NOT editable here — changing them
 * would move a person between tenants or grant access, which is a different
 * operation with different rules, not a profile edit. Deactivation stays on
 * `/api/staff/[id]`, which already audits it.
 */
export const PATCH = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = EditManager.parse(await req.json().catch(() => null));

    const manager = await prisma.manager.findUnique({
      where: { id: params.id },
      select: { id: true, universityId: true, employeeCode: true, userId: true },
    });
    if (!manager) throw new ApiError(404, "NOT_FOUND", "Manager not found");
    assertCanAccessUniversity(scope, manager.universityId);

    // Employee codes are unique per university; catching it here produces a
    // readable 409 rather than a driver error from the unique index.
    if (input.employeeCode) {
      const clash = await prisma.manager.findFirst({
        where: {
          universityId: manager.universityId,
          employeeCode: input.employeeCode,
          NOT: { id: manager.id },
        },
        select: { id: true },
      });
      if (clash) {
        throw new ApiError(409, "EMPLOYEE_CODE_IN_USE", "That employee ID is already used here");
      }
    }

    const updated = await prisma.manager.update({
      where: { id: manager.id },
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
      action: "MANAGER_UPDATED",
      entityType: "Manager",
      entityId: manager.id,
      universityId: manager.universityId,
      metadata: { fields: Object.keys(input) },
    });

    return NextResponse.json({ manager: updated });
  },
  { roles: ["ADMIN"] },
);
