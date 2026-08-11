import { NextResponse } from "next/server";
import { clearSessionCookie, revokeSession } from "@/server/auth/session";
import { withAuth } from "@/server/http/route";

export const POST = withAuth(async ({ principal }) => {
  await revokeSession(principal.sessionId);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
