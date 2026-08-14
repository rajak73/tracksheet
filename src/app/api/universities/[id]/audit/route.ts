import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { parseLimit, parsePage } from "@/server/http/params";

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
    const limit = parseLimit(req.nextUrl.searchParams.get("limit"), { fallback: 100, max: 200 });
    const page = parsePage(req.nextUrl.searchParams.get("page"));

    const where = {
      universityId: params.id,
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
    };

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { name: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return NextResponse.json({ entries, page, limit, total, hasMore: page * limit < total });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
