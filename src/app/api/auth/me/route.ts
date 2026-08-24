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

  /* The earliest day this person could have recorded anything.
   *
   * The work log clamps its date pickers to it. Before somebody's record
   * exists there is no day of theirs to look at, so a filter reaching further
   * back returns nothing no matter how it is set — which reads as the page
   * being broken rather than as a period with nothing in it. Sent as the raw
   * instant, because which CALENDAR DAY it falls on is a question only the
   * university's zone can answer, and that is right here in this response.
   *
   * Null for a manager or an admin: neither has a work log of their own. */
  const recordsFrom = principal.instructorId
    ? ((
        await prisma.instructor.findUnique({
          where: { id: principal.instructorId },
          select: { createdAt: true },
        })
      )?.createdAt.toISOString() ?? null)
    : null;

  return NextResponse.json({
    timezone,
    recordsFrom,
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
