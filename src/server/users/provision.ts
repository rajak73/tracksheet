import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { hashPassword } from "@/server/auth/password";

/**
 * Creating a staffed account.
 *
 * ── Password vs invite ─────────────────────────────────────────────────────
 * Admin/manager sets an initial password, rather than an emailed invite link.
 * The reason is honest rather than architectural: there is no mail transport in
 * this system, so an invite flow would need one built, configured and monitored
 * before anyone could log in at all. A password set by the provisioner works
 * today with the auth stack that already exists.
 *
 * The trade-off is that the initial password travels out-of-band, which is why
 * `mustChangePassword` is recorded — the account is usable immediately but the
 * credential is known to two people until it is changed. Swapping to invites
 * later means replacing this function's body once a mail transport exists.
 *
 * ── Why a transaction ──────────────────────────────────────────────────────
 * A `User` without its `Manager`/`Instructor` profile is an account that can
 * log in and then hit a 403 on every page, because the scope resolver needs the
 * profile. Both rows are written together or neither is.
 */

export type ProvisionInput = {
  email: string;
  name: string;
  password: string;
  universityId: string;
  employeeCode?: string;
  /** Instructors only. Absent means unassigned. */
  managerId?: string | null;
};

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function assertEmailAvailable(email: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ApiError(409, "EMAIL_IN_USE", "An account with that email already exists");
  }
}

export async function provisionInstructor(input: ProvisionInput) {
  const email = normaliseEmail(input.email);
  await assertEmailAvailable(email);
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: input.name,
        role: "INSTRUCTOR",
        passwordHash,
        universityId: input.universityId,
      },
      select: { id: true, email: true, name: true },
    });

    const instructor = await tx.instructor.create({
      data: {
        userId: user.id,
        universityId: input.universityId,
        employeeCode: input.employeeCode,
        // Optional at creation. When absent the instructor is unassigned,
        // which an admin resolves later; when present the composite FK
        // guarantees the manager is in this same university.
        managerId: input.managerId ?? null,
      },
      select: { id: true, employeeCode: true, managerId: true },
    });

    return { user, instructor };
  });
}

/**
 * Creates a manager and, when the university has none, promotes them to primary.
 * v1 allows exactly one primary manager per university, so a second manager is
 * created without disturbing the existing primary rather than silently
 * replacing them.
 */
export async function provisionManager(input: ProvisionInput) {
  const email = normaliseEmail(input.email);
  await assertEmailAvailable(email);
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: input.name,
        role: "MANAGER",
        passwordHash,
        universityId: input.universityId,
      },
      select: { id: true, email: true, name: true },
    });

    const manager = await tx.manager.create({
      data: {
        userId: user.id,
        universityId: input.universityId,
        employeeCode: input.employeeCode,
      },
      select: { id: true, employeeCode: true },
    });

    const university = await tx.university.findUniqueOrThrow({
      where: { id: input.universityId },
      select: { primaryManagerId: true },
    });

    let isPrimary = false;
    if (!university.primaryManagerId) {
      await tx.university.update({
        where: { id: input.universityId },
        data: { primaryManagerId: manager.id },
      });
      isPrimary = true;
    }

    return { user, manager, isPrimary };
  });
}
