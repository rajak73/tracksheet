import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { loadUniversityConfig } from "@/server/universities/config";
import { assertValidDate } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";
import { logAudit } from "@/server/audit/logger";

export const GET = withAuth<{ id: string }>(async ({ scope, params }) => {
  assertCanAccessUniversity(scope, params.id);
  const { holidays } = await loadUniversityConfig(params.id);
  return NextResponse.json({ holidays });
});

const HolidayInput = z.object({
  date: z.string(),
  name: z.string().min(1).max(200),
});

/** Admin only, per the same role gate the config PATCH uses. */
export const POST = withAuth<{ id: string }>(
  async ({ params, req, principal, scope }) => {
    const input = HolidayInput.parse(await req.json().catch(() => null));
    assertValidDate(input.date);

    // Confirms the university exists before writing, giving 404 rather than a
    // raw foreign-key error.
    await loadUniversityConfig(params.id);

    const existing = await prisma.universityHoliday.findUnique({
      where: {
        universityId_date: { universityId: params.id, date: toDateOnly(input.date) },
      },
    });
    if (existing) {
      throw new ApiError(409, "HOLIDAY_EXISTS", `${input.date} is already a holiday`);
    }

    const holiday = await prisma.universityHoliday.create({
      data: { universityId: params.id, date: toDateOnly(input.date), name: input.name },
      select: { id: true, name: true },
    });

    await logAudit(principal, scope, {
      action: "HOLIDAY_ADDED",
      entityType: "UniversityHoliday",
      entityId: holiday.id,
      universityId: params.id,
      metadata: { date: input.date, name: input.name },
    });

    return NextResponse.json({ holiday: { ...holiday, date: input.date } }, { status: 201 });
  },
  { roles: ["ADMIN"] },
);
