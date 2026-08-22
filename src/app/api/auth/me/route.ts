import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";

/** Source of truth the frontend uses to pick which dashboard to render.
 *  The role comes from the session, never from a client-side choice. */
export const GET = withAuth(async ({ principal, scope }) => {
  /* The university's timezone, so a screen can work out what "today" means
   * where the WORK happens rather than where the browser is. Every day boundary
   * on the server is judged in this zone, and a client that guesses its own
   * offers dates the server then refuses. An admin has no university and gets
   * null, which callers read as "use the browser's". */
  const timezone = principal.universityId
    ? ((
        await prisma.university.findUnique({
          where: { id: principal.universityId },
          select: { timezone: true },
        })
      )?.timezone ?? null)
    : null;

  return NextResponse.json({
    timezone,
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
