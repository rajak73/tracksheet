import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/http/route";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/http/errors";

/**
 * Unread notifications.
 *
 * Filters on `readAt IS NULL`, not on `isRead`. The schema documents the
 * unread query as `(userId, readAt, createdAt)` and carries exactly that
 * index — but the code filtered `isRead`, a different column, so the index
 * was never used (lifetime idx_scan = 0) and every badge fetch degenerated
 * into a filter plus a separate sort. Worse, `readAt` was never written by
 * anything, so the column that exists to answer "when was this read" was
 * permanently NULL.
 *
 * `isRead` is kept in sync on write below so the boolean stays truthful for
 * any future reader, but `readAt` is now the column the query and the index
 * agree on.
 */
export const GET = withAuth(async ({ principal }) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: principal.userId, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ notifications });
});

const PatchInput = z.object({ action: z.literal("MARK_ALL_READ") });

export const PATCH = withAuth(async ({ req, principal }) => {
  // `.catch(() => null)`, matching every other write route: a malformed body
  // must fail zod's 400 rather than reach `.action` on `undefined` and 500.
  const body = PatchInput.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid action");
  }

  await prisma.notification.updateMany({
    where: { userId: principal.userId, readAt: null },
    // Both, deliberately: `readAt` is what the unread query and its index use
    // and records WHEN; `isRead` is kept consistent so the boolean never
    // contradicts the timestamp.
    data: { isRead: true, readAt: new Date() },
  });
  return NextResponse.json({ success: true });
});
