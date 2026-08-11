import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";

export const DELETE = withAuth<{ id: string; holidayId: string }>(
  async ({ params }) => {
    // Scoped by universityId in the predicate, so a holiday id from another
    // university cannot be deleted even by guessing it.
    const result = await prisma.universityHoliday.deleteMany({
      where: { id: params.holidayId, universityId: params.id },
    });
    if (result.count === 0) {
      throw new ApiError(404, "NOT_FOUND", "Holiday not found");
    }
    return NextResponse.json({ ok: true });
  },
  { roles: ["ADMIN"] },
);
