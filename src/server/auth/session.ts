import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import type { Role } from "@/generated/prisma/client";

export const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "tracksheet_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);

/** The authenticated principal. Every field here is read from the database on
 *  each request — nothing in it originates from the client. */
export type Principal = {
  userId: string;
  email: string;
  name: string;
  role: Role;
  /** null only for ADMIN, guaranteed by the `user_role_tenant_binding` CHECK. */
  universityId: string | null;
  /** Present only for INSTRUCTOR. */
  instructorId: string | null;
  /** Present only for MANAGER. */
  managerId: string | null;
  sessionId: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueSession(
  userId: string,
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600_000);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    },
  });

  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Resolves the caller from the session cookie. Returns null for any failure
 * mode — absent, unknown, expired, revoked, or belonging to a disabled user —
 * so callers cannot accidentally distinguish them.
 */
export async function getPrincipal(): Promise<Principal | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          instructorProfile: { select: { id: true } },
          managerProfile: { select: { id: true } },
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.isActive) return null;

  const { user } = session;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    universityId: user.universityId,
    instructorId: user.instructorProfile?.id ?? null,
    managerId: user.managerProfile?.id ?? null,
    sessionId: session.id,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
