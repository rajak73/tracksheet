import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

/**
 * Employment state for one staff member.
 *
 * ── The only thing this writes is a boolean ────────────────────────────────
 * Deactivation is `User.isActive = false` and NOTHING else. No row is deleted,
 * no history is touched, no cascade fires. That is the whole point: someone who
 * leaves in September still did real work in August, and August's report has to
 * keep saying so. The historical tracker deliberately opts former staff back in
 * (`includeInactive`), while every operational surface keeps excluding them.
 *
 * ── Why this is a User-level route ─────────────────────────────────────────
 * `isActive` lives on `User`, and a manager and an instructor are both a User
 * with a profile. Putting the flag anywhere else would mean two ways to be
 * inactive and, eventually, two answers to "can this person log in".
 *
 * Access is revoked on the NEXT request, not at the moment of the write:
 * `getPrincipal` re-reads `isActive` per request, so an existing session stops
 * working immediately without needing a session sweep.
 *
 * ADMIN only. A manager cannot end someone's employment.
 */

const PatchStaff = z.object({
  isActive: z.boolean(),
  /** Optional free-text note recorded on the audit entry, never on the user. */
  reason: z.string().max(500).optional(),
});

export const PATCH = withAuth<{ id: string }>(
  async ({ params, req, principal, scope }) => {
    const input = PatchStaff.parse(await req.json().catch(() => null));

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        universityId: true,
        instructorProfile: { select: { id: true, employeeCode: true } },
        managerProfile: { select: { id: true, employeeCode: true } },
      },
    });

    if (!user) {
      throw new ApiError(404, "NOT_FOUND", "Staff member not found");
    }

    // An admin is a platform operator, not staff. Allowing this route to
    // deactivate one would let an admin lock themselves — or every other
    // admin — out of the system with a single request.
    if (user.role === "ADMIN") {
      throw new ApiError(
        403,
        "NOT_STAFF",
        "Administrator accounts are not managed through the staff directory",
      );
    }

    if (user.isActive === input.isActive) {
      // Idempotent rather than an error: two clicks on Deactivate should not
      // produce a failure the operator has to interpret.
      return NextResponse.json({ staff: publicShape(user, input.isActive) });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive: input.isActive },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        universityId: true,
        instructorProfile: { select: { id: true, employeeCode: true } },
        managerProfile: { select: { id: true, employeeCode: true } },
      },
    });

    await logAudit(principal, scope, {
      action: input.isActive ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
      entityType: "User",
      entityId: user.id,
      universityId: user.universityId,
      // Metadata carries who and why — never a credential of any kind.
      metadata: {
        name: user.name,
        role: user.role,
        employeeCode:
          user.instructorProfile?.employeeCode ?? user.managerProfile?.employeeCode ?? null,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });

    return NextResponse.json({ staff: publicShape(updated, updated.isActive) });
  },
  { roles: ["ADMIN"] },
);

/** The shape returned to a client. Deliberately never includes a credential. */
function publicShape(
  user: {
    id: string;
    name: string;
    role: string;
    universityId: string | null;
    instructorProfile: { id: string; employeeCode: string | null } | null;
    managerProfile: { id: string; employeeCode: string | null } | null;
  },
  isActive: boolean,
) {
  return {
    userId: user.id,
    name: user.name,
    role: user.role,
    isActive,
    universityId: user.universityId,
    employeeCode:
      user.instructorProfile?.employeeCode ?? user.managerProfile?.employeeCode ?? null,
    instructorId: user.instructorProfile?.id ?? null,
  };
}
