import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { instructorWhere } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";

/**
 * ONE endpoint, all three roles (per the global application model).
 *
 * Admin      → every instructor, optionally narrowed with ?universityId=
 * Manager    → their own university's instructors only
 * Instructor → exactly one row: themselves
 *
 * The response differs purely because the scope differs. There is no
 * role-specific variant of this route, and no branch here reads a role.
 */
export const GET = withAuth(async ({ scope, req }) => {
  // The entire tenant decision happens in instructorWhere. This route builds no
  // scope predicate of its own, and throws 403 via that helper if the caller
  // asks for a university outside its scope.
  const where = instructorWhere(scope, req.nextUrl.searchParams.get("universityId"));

  const instructors = await prisma.instructor.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      universityId: true,
      employeeCode: true,
      user: { select: { id: true, name: true, email: true, isActive: true } },
      university: { select: { id: true, name: true, slug: true, timezone: true } },
    },
  });

  return NextResponse.json({ instructors, scope: scope.kind });
});
