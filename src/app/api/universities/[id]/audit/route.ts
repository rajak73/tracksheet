import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";

/**
 * Audit trail for one university.
 *
 * Admin and manager only. An audit log records who did what to whom, so it is
 * inherently about other people — exposing it to an instructor would leak
 * colleague activity that every other endpoint carefully withholds.
 */
export const GET = withAuth<{ id: string }>(
  async ({ params, scope, req }) => {
    assertCanAccessUniversity(scope, params.id);

    const action = req.nextUrl.searchParams.get("action");
    const entityType = req.nextUrl.searchParams.get("entityType");
    const limit = Math.min(200, Number(req.nextUrl.searchParams.get("limit") ?? 100));

    const entries = await prisma.auditLog.findMany({
      where: {
        universityId: params.id,
        ...(action ? { action } : {}),
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { user: { select: { name: true, email: true, role: true } } },
    });

    return NextResponse.json({ entries });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
