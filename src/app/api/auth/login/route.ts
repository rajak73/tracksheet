import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { fakeVerifyDelay, verifyPassword } from "@/server/auth/password";
import { issueSession, setSessionCookie } from "@/server/auth/session";
import { jsonError, withPublic } from "@/server/http/route";

const LoginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

// Note what this body does NOT accept: no role, no universityId. Both are
// derived server-side from the stored user record.
export const POST = withPublic(async (req) => {
  const parsed = LoginBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Email and password are required");
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      instructorProfile: { select: { id: true } },
      managerProfile: { select: { id: true } },
      university: { select: { id: true, name: true, slug: true, timezone: true } },
    },
  });

  // Same generic failure and comparable timing whether the email is unknown,
  // the password is wrong, or the account is disabled.
  if (!user || !user.isActive) {
    await fakeVerifyDelay();
    return jsonError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return jsonError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  const { token, expiresAt } = await issueSession(user.id, {
    userAgent: req.headers.get("user-agent"),
    ipAddress: req.headers.get("x-forwarded-for"),
  });
  await setSessionCookie(token, expiresAt);

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      universityId: user.universityId,
      university: user.university,
      instructorId: user.instructorProfile?.id ?? null,
      managerId: user.managerProfile?.id ?? null,
    },
  });
});
