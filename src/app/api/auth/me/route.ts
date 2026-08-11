import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";

/** Source of truth the frontend uses to pick which dashboard to render.
 *  The role comes from the session, never from a client-side choice. */
export const GET = withAuth(async ({ principal, scope }) => {
  return NextResponse.json({
    user: {
      id: principal.userId,
      email: principal.email,
      name: principal.name,
      role: principal.role,
      universityId: principal.universityId,
      instructorId: principal.instructorId,
      managerId: principal.managerId,
    },
    scope: { kind: scope.kind },
  });
});
