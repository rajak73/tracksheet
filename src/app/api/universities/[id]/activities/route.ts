import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { instructorOwnedWhere } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { parseDateParam } from "@/server/http/params";

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  // Throws 403 for another tenant, and pins instructorId for a self-scoped
  // caller so an instructor sees only their own logs on this shared endpoint.
  const scopeWhere = instructorOwnedWhere(scope, params.id);

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Validated up front so a malformed ?from= is a 400, not a Prisma crash.
  const fromDate = parseDateParam(from, "from");
  const toDate = parseDateParam(to, "to");

  let dateFilter = {};
  if (fromDate || toDate) {
    dateFilter = {
      workDate: {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      },
    };
  }

  const [activities, university] = await Promise.all([
    prisma.activityLog.findMany({
      where: {
        ...scopeWhere,
        ...dateFilter,
      },
      include: {
        activityType: true,
        instructor: {
          select: {
            id: true,
            employeeCode: true,
            user: {
              select: { name: true, email: true },
            },
          },
        },
      },
      orderBy: [
        { workDate: "asc" },
        { startTime: "asc" },
      ],
    }),
    prisma.university.findUnique({
      where: { id: params.id },
      select: { timezone: true },
    }),
  ]);

  // The zone these instants should be DISPLAYED in. Without it, pages fell
  // back to rendering UTC — a 10:00 Kolkata class read back as 04:30.
  return NextResponse.json({ activities, timezone: university?.timezone ?? "UTC" });
});
