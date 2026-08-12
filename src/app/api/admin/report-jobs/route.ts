import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";

/** Export history across the platform. Admin-only: it spans every tenant. */
export const GET = withAuth(
  async ({ req }) => {
    const limit = Math.min(100, Number(req.nextUrl.searchParams.get("limit") ?? 50));
    const jobs = await prisma.reportJob.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        requestedBy: { select: { name: true, email: true } },
        university: { select: { name: true, code: true } },
      },
    });
    return NextResponse.json({ jobs });
  },
  { roles: ["ADMIN"] },
);
