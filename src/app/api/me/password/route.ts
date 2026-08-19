import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { MIN_PASSWORD_LENGTH } from "@/server/users/bootstrap-admin";

/**
 * Changing your own password.
 *
 * ── This did not exist, and its absence was load-bearing ───────────────────
 * Until now a password could only ever be set at creation. That is why the bulk
 * importer has to take an initial password for the accounts it creates: an
 * account made without a usable credential could never have been given one.
 * This route closes that gap for the account holder.
 *
 * ── The current password is required ───────────────────────────────────────
 * A live session is not sufficient authority to change the credential that
 * session was issued against. An unattended laptop, a borrowed phone or a
 * stolen cookie would otherwise be enough to lock the real owner out of their
 * own account. Proving knowledge of the current password is what makes that a
 * different, harder attack.
 *
 * ── Every other session is ended ───────────────────────────────────────────
 * People change their password precisely BECAUSE they think somebody else has
 * access. Leaving that somebody signed in would defeat the act. The caller's own
 * session survives, so they are not signed out of the tab they are using.
 */
const ChangePassword = z
  .object({
    currentPassword: z.string().min(1).max(1024),
    newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(1024),
    confirmPassword: z.string().min(1).max(1024),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "The new passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "The new password must be different from the current one",
    path: ["newPassword"],
  });

export const POST = withAuth(async ({ principal, scope, req }) => {
  const input = ChangePassword.parse(await req.json().catch(() => null));

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: principal.userId },
    select: { id: true, passwordHash: true },
  });

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    // Deliberately not "wrong password" versus "no password set": the caller is
    // already authenticated, so there is nothing to enumerate, but a single
    // message keeps the response identical for every failure mode.
    throw new ApiError(400, "INVALID_CREDENTIALS", "Your current password is not correct.");
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId: user.id, id: { not: principal.sessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await logAudit(principal, scope, {
    action: "PASSWORD_CHANGED",
    entityType: "User",
    entityId: user.id,
    // No password material of any kind, in either direction.
    metadata: { otherSessionsRevoked: true },
  });

  return NextResponse.json({ ok: true });
});
