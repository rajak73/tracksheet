import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { instructorOwnedWhere } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";

export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  // Throws 403 for another tenant, and pins instructorId for a self-scoped
  // caller so an instructor sees only their own logs on this shared endpoint.
  const scopeWhere = instructorOwnedWhere(scope, params.id);

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let dateFilter = {};
  if (from || to) {
    dateFilter = {
      workDate: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      },
    };
  }

  const activities = await prisma.activityLog.findMany({
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
  });

  return NextResponse.json({ activities });
});
