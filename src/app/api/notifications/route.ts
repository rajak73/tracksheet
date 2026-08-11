import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";

export const GET = withAuth(async ({ principal }) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: principal.userId, isRead: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ notifications });
});

export const PATCH = withAuth(async ({ req, principal }) => {
  const body = await req.json();
  if (body.action === "MARK_ALL_READ") {
    await prisma.notification.updateMany({
      where: { userId: principal.userId, isRead: false },
      data: { isRead: true }
    });
    return NextResponse.json({ success: true });
  }

  throw new ApiError(400, "BAD_REQUEST", "Invalid action");
});
