import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";

/**
 * The broad categories an instructor can be filed under.
 *
 * ── Why this is a route and not a constant in the bundle ──────────────────
 * The list is reference DATA, seeded like the activity taxonomy, so adding a
 * stream is an insert and a seed run. A copy hard-coded in the client would be
 * a second list free to disagree with the one the foreign key enforces — the
 * dropdown would offer something the database then refuses.
 *
 * Readable by any signed-in user: it is a vocabulary, not a tenant's data. It
 * carries no university, no person and no hours.
 */
export const GET = withAuth(async () => {
  const categories = await prisma.instructorCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { code: true, label: true },
  });

  return NextResponse.json({ categories });
});
