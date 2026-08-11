import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { universityWhere } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";

/** Admin sees all universities; manager and instructor see only their own. */
export const GET = withAuth(async ({ scope }) => {
  const universities = await prisma.university.findMany({
    where: scope.kind === "global" ? {} : { id: universityWhere(scope).universityId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      openingDurationMin: true,
      closingDurationMin: true,
      workingHours: {
        orderBy: { dayOfWeek: "asc" },
        select: { dayOfWeek: true, isWorkingDay: true, startMinute: true, endMinute: true },
      },
      _count: { select: { instructors: true, managers: true } },
    },
  });

  return NextResponse.json({ universities, scope: scope.kind });
});
