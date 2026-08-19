import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";

/**
 * Employment state for one staff member.
 *
 * ── Nothing is ever deleted ────────────────────────────────────────────────
 * No row is removed, no history is touched, no cascade fires. Someone who
 * leaves in September still did real work in August, and August's report has to
 * keep saying so. The historical tracker deliberately opts former staff back in
 * (`includeInactive`), while every operational surface keeps excluding them.
 *
 * ── What a departure writes ────────────────────────────────────────────────
 *   isActive   false — the security answer. Login refuses, and session
 *              validation refuses too, so a signed-in tab dies on its next
 *              request rather than at its next login.
 *   deletedAt  when they left — the operational answer. This is what makes a
 *              leavers list a query instead of a trawl through the audit log.
 *   leftReason why, in the operator's words.
 *   sessions   every one of them revoked, in the same transaction.
 *
 * The `isActive` check alone would already stop a departed person signing in.
 * The sessions are revoked anyway, because "they can no longer log in" should
 * be true of the DATA and not only of the code path that reads it — a live
 * session row for someone who has left is a thing waiting to be honoured by
 * some future query that forgets to ask.
 *
 * ── A manager cannot leave and take their roster with them ─────────────────
 * Deactivating a manager used to leave every instructor still pointing at them.
 * Not `null` — pointing at a person who cannot sign in. So the primary manager
 * did not pick them up either (that fallback only covers `managerId: null`),
 * and their recorded work became invisible to EVERY manager while looking
 * perfectly fine on the instructor's own page. That is the worst kind of gap:
 * silent, and only discovered when a month's figures are already wrong.
 *
 * So a departing manager who still holds a roster, or who is the university's
 * primary, must name a successor. The roster moves in the same transaction. The
 * refusal is a 422 that says how many people are waiting, because the operator
 * cannot answer a question the system has not asked.
 *
 * ── Why this is a User-level route ─────────────────────────────────────────
 * `isActive` lives on `User`, and a manager and an instructor are both a User
 * with a profile. Putting the flag anywhere else would mean two ways to be
 * inactive and, eventually, two answers to "can this person log in".
 *
 * ADMIN only. A manager cannot end someone's employment.
 */

const PatchStaff = z.object({
  isActive: z.boolean(),
  /** Why they left. Recorded on the user AND on the audit entry. */
  reason: z.string().max(500).optional(),
  /**
   * Who takes the departing manager's roster. Required when they still hold
   * one, or when they are the university's primary manager; ignored otherwise.
   */
  successorManagerId: z.string().min(1).optional(),
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
        managerProfile: {
          select: {
            id: true,
            employeeCode: true,
            _count: { select: { instructors: true } },
          },
        },
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

    /* ── A departing manager has to say where their roster goes ──────────── */
    const leaving = !input.isActive;
    const manager = user.managerProfile;
    let handover: { successorId: string; successorName: string; moved: number } | null = null;

    if (leaving && manager && user.universityId) {
      const university = await prisma.university.findUnique({
        where: { id: user.universityId },
        select: { primaryManagerId: true },
      });
      const isPrimary = university?.primaryManagerId === manager.id;
      const rosterSize = manager._count.instructors;

      if (rosterSize > 0 || isPrimary) {
        if (!input.successorManagerId) {
          throw new ApiError(
            422,
            "SUCCESSOR_REQUIRED",
            rosterSize > 0
              ? `${user.name} still leads ${rosterSize} instructor${rosterSize === 1 ? "" : "s"}. Name the manager who takes them over.`
              : `${user.name} is this university's primary manager. Name the manager who takes over.`,
            { rosterSize, isPrimary },
          );
        }

        const successor = await prisma.manager.findUnique({
          where: { id: input.successorManagerId },
          select: { id: true, universityId: true, user: { select: { name: true, isActive: true } } },
        });

        // Same university, still employed, and not the person walking out the
        // door. Each of these is a different mistake and gets its own message.
        if (!successor || successor.universityId !== user.universityId) {
          throw new ApiError(422, "BAD_SUCCESSOR", "That manager is not in this university.");
        }
        if (successor.id === manager.id) {
          throw new ApiError(422, "BAD_SUCCESSOR", "A manager cannot hand their roster to themselves.");
        }
        if (!successor.user.isActive) {
          throw new ApiError(422, "BAD_SUCCESSOR", "That manager has left too. Choose someone active.");
        }

        handover = { successorId: successor.id, successorName: successor.user.name, moved: rosterSize };
      }
    }

    const now = new Date();

    /* One transaction. A roster half-moved, or an account deactivated without
     * its sessions dying, is a worse state than either change not happening. */
    const [updated] = await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          isActive: input.isActive,
          // Reinstatement clears both, so a returning employee is not left
          // reading as someone who left and came back as a ghost.
          deletedAt: leaving ? now : null,
          leftReason: leaving ? (input.reason?.trim() || null) : null,
        },
        select: {
          id: true,
          name: true,
          role: true,
          isActive: true,
          universityId: true,
          instructorProfile: { select: { id: true, employeeCode: true } },
          managerProfile: { select: { id: true, employeeCode: true } },
        },
      }),

      // Belt as well as braces — see the note at the top of this file.
      ...(leaving
        ? [
            prisma.session.updateMany({
              where: { userId: user.id, revokedAt: null },
              data: { revokedAt: now },
            }),
          ]
        : []),

      ...(handover
        ? [
            prisma.instructor.updateMany({
              where: { managerId: manager!.id },
              data: { managerId: handover.successorId },
            }),
            // The primary is a property of the UNIVERSITY, so it has to move
            // too, or the tenant is left pointing at someone who has gone.
            prisma.university.updateMany({
              where: { id: user.universityId!, primaryManagerId: manager!.id },
              data: { primaryManagerId: handover.successorId },
            }),
          ]
        : []),
    ]);

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
        ...(handover
          ? {
              rosterHandedTo: handover.successorName,
              rosterHandedToId: handover.successorId,
              instructorsMoved: handover.moved,
            }
          : {}),
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
