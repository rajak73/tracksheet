import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { streamsFor } from "@/server/instructors/stream";
import type { Prisma } from "@/generated/prisma/client";
import { instructorWhere, narrowManager } from "@/server/auth/scope";
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

  // Roster filter. `narrowManager` decides what the caller is allowed to ask
  // for — an admin any roster or `unassigned`, a manager only their own — so
  // this route still builds no authorisation predicate of its own.
  Object.assign(where, narrowManager(scope, searchParams.get("managerId")));
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
        managerId: true,
        /* `category` is selected again, on the client's instruction.
         *
         * It stopped being selected when the stream was derived from somebody's
         * entries instead of assigned. The client's rule now is that the Broad
         * Category on the report is supplied and must be preserved exactly, so
         * the assigned value is what the report needs — and a directory that
         * cannot show it is a directory nobody can use to fix it.
         *
         * The derived stream still comes back too, under its own name. Two
         * different questions, never again under one key. */
        category: { select: { code: true, label: true } },
        manager: { select: { id: true, employeeCode: true, user: { select: { name: true } } } },
        user: { select: { id: true, name: true, email: true, isActive: true } },
        university: { select: { id: true, name: true, slug: true, timezone: true } },
      },
    }),
    prisma.instructor.count({ where }),
  ]);

  /* Their stream, counted from what they actually taught.
   *
   * Beside their assigned `category`, not instead of it. The stream answers
   * "what has this person actually been teaching lately", which is a useful
   * thing for an admin deciding what to assign — and it is emphatically NOT the
   * report's Broad Category any more, which the client requires to be the value
   * somebody supplied.
   *
   * One grouped query for the whole page rather than one per row — the
   * directory renders everybody at once. An instructor with no subject-carrying
   * work is absent from the map and comes back as null. */
  const streams = await streamsFor(instructors.map((i) => i.id));

  /* No insight travels with this response any more.
   *
   * It used to carry a stored reading per instructor: a severity band, a title
   * like "Well below the day's hours", and a recommendation naming what they
   * should have classified. That was a model's judgement about a person, stored
   * against their record and rendered as a coloured chip — the same class of
   * thing as the Watch badge, and removed with it.
   *
   * The insight a day genuinely has is served from `ai_insight_cache`, per day,
   * to the viewer who asked for it, and it grades nobody. */

  return NextResponse.json({
    // `manager` is flattened to the three fields a roster UI needs, and stays
    // explicitly null when nobody leads this instructor yet — "unassigned" is a
    // state to render, not an absence to hide.
    instructors: instructors.map(({ manager, ...rest }) => ({
      ...rest,
      // `category` is the assigned one, straight from the row above.
      stream: streams.get(rest.id) ?? null,
      manager: manager
        ? { id: manager.id, employeeCode: manager.employeeCode, name: manager.user.name }
        : null,
    })),
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
  /** Optional roster placement. Omit to create the instructor unassigned. */
  managerId: z.string().min(1).nullable().optional(),
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
      // A manager provisioning someone is placing them on their OWN team —
      // that is what the action means, and leaving them unassigned would hide
      // the person from the very manager who just created them. This is not
      // inferred ownership: the manager is acting, now, deliberately. An
      // explicit managerId in the body is refused rather than honoured, since
      // a manager may not staff a colleague's roster.
      // `university` is the only non-global scope that reaches here — the route
      // is ADMIN/MANAGER only — but narrowing keeps that a checked fact.
      const own = scope.kind === "university" ? scope.managerId : null;
      if (input.managerId && input.managerId !== own) {
        throw new ApiError(403, "CROSS_MANAGER_DENIED", "You can only add to your own roster");
      }
      input.managerId = own;
    }

    await prisma.university.findUniqueOrThrow({ where: { id: universityId }, select: { id: true } });

    // A named manager must lead in this same university. The composite FK would
    // reject a mismatch regardless; this turns it into a readable 422.
    if (input.managerId) {
      const manager = await prisma.manager.findUnique({
        where: { id: input.managerId },
        select: { universityId: true },
      });
      if (!manager) throw new ApiError(404, "MANAGER_NOT_FOUND", "Manager not found");
      if (manager.universityId !== universityId) {
        throw new ApiError(
          422,
          "CROSS_TENANT_ASSIGNMENT",
          "A manager can only lead instructors in their own university",
        );
      }
    }

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
