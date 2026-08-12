import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { fakeVerifyDelay, verifyPassword } from "@/server/auth/password";
import { issueSession, setSessionCookie } from "@/server/auth/session";
import { jsonError, withPublic } from "@/server/http/route";
import { AUTH_LIMITS, clientIp, hit } from "@/server/http/rate-limit";

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

  // Limited by IP and by account. IP alone would let one attacker behind a NAT
  // lock out a whole office; email alone would let a distributed attacker
  // spread across addresses. The response is identical either way so the
  // limiter cannot be used to enumerate which accounts exist.
  const ip = clientIp(req.headers);
  const ipHit = hit(`login:ip:${ip}`, AUTH_LIMITS.perIp.limit, AUTH_LIMITS.perIp.windowMs);
  const emailHit = hit(`login:email:${email}`, AUTH_LIMITS.perEmail.limit, AUTH_LIMITS.perEmail.windowMs);

  if (!ipHit.allowed || !emailHit.allowed) {
    const retryAfter = Math.max(ipHit.retryAfterSeconds, emailHit.retryAfterSeconds);
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." } },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
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

  // Recorded after the password check, so a failed attempt cannot be used to
  // probe whether an account is active.
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

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
