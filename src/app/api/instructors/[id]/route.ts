import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructor } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";

export const GET = withAuth<{ id: string }>(async ({ scope, params }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      employeeCode: true,
      user: { select: { id: true, name: true, email: true, isActive: true } },
      university: { select: { id: true, name: true, slug: true, timezone: true } },
    },
  });

  if (!instructor) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Instructor not found" } },
      { status: 404 },
    );
  }

  // Throws 404 (not 403) when out of scope, so the endpoint cannot be used to
  // probe which instructor ids exist in other tenants.
  assertCanReadInstructor(scope, instructor);

  return NextResponse.json({ instructor });
});
