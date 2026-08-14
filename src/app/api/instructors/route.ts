import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { instructorWhere } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { logAudit } from "@/server/audit/logger";
import { parseLimit, parsePage } from "@/server/http/params";
import { provisionInstructor } from "@/server/users/provision";

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
  const { searchParams } = new URL(req.url);
  const page = parsePage(searchParams.get("page"));
  const limit = parseLimit(searchParams.get("limit"), { fallback: 50, max: 200 });
  const search = searchParams.get("search")?.trim();

  // The entire tenant decision happens in instructorWhere. This route builds no
  // scope predicate of its own, and throws 403 via that helper if the caller
  // asks for a university outside its scope.
  const where: Prisma.InstructorWhereInput = instructorWhere(scope, searchParams.get("universityId"));
  if (search) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { user: { name: { contains: search, mode: "insensitive" } } },
          { user: { email: { contains: search, mode: "insensitive" } } },
          { employeeCode: { contains: search, mode: "insensitive" } },
          // Matches the admin instructor list's pre-pagination client-side
          // filter, which also matched on university name (only meaningful
          // for the global/admin scope — a manager's own roster is already
          // narrowed to one university).
          { university: { name: { contains: search, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const [instructors, total] = await Promise.all([
    prisma.instructor.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        universityId: true,
        employeeCode: true,
        user: { select: { id: true, name: true, email: true, isActive: true } },
        university: { select: { id: true, name: true, slug: true, timezone: true } },
      },
    }),
    prisma.instructor.count({ where }),
  ]);

  return NextResponse.json({
    instructors,
    scope: scope.kind,
    page,
    limit,
    total,
    hasMore: page * limit < total,
  });
});


const CreateInstructor = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  password: z.string().min(12).max(1024),
  employeeCode: z.string().max(64).optional(),
  /** Required for an admin, ignored for a manager — see below. */
  universityId: z.string().optional(),
});

/**
 * Creates an instructor.
 *
 * The tenant is resolved from the SESSION for a manager and is never taken
 * from the body: a manager who posts another university's id would otherwise
 * be creating staff inside a tenant they cannot see. An admin is global and so
 * must say which university they mean.
 */
export const POST = withAuth(
  async ({ req, scope, principal }) => {
    const input = CreateInstructor.parse(await req.json().catch(() => null));

    let universityId: string;
    if (scope.kind === "global") {
      if (!input.universityId) {
        throw new ApiError(400, "UNIVERSITY_REQUIRED", "An admin must specify universityId");
      }
      universityId = input.universityId;
    } else {
      // A manager's own university, from the session. A universityId in the
      // body is ignored rather than trusted.
      universityId = scope.universityId;
      if (input.universityId && input.universityId !== universityId) {
        throw new ApiError(403, "CROSS_TENANT_DENIED", "University is outside your scope");
      }
    }

    await prisma.university.findUniqueOrThrow({ where: { id: universityId }, select: { id: true } });

    const result = await provisionInstructor({ ...input, universityId });

    await logAudit(principal, scope, {
      action: "INSTRUCTOR_CREATED",
      entityType: "Instructor",
      entityId: result.instructor.id,
      universityId,
      metadata: { universityId, email: result.user.email },
    });

    return NextResponse.json(
      { instructor: { ...result.instructor, user: result.user, universityId } },
      { status: 201 },
    );
  },
  { roles: ["ADMIN", "MANAGER"] },
);
