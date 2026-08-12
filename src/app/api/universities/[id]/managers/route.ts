import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";

/**
 * Managers of a university — the level the admin drill-down was missing
 * (university -> MANAGER -> instructor -> date -> activity).
 *
 * Each manager carries the instructor count they are responsible for, so the
 * drill-down step has something to show rather than just a name.
 */
export const GET = withAuth<{ id: string }>(
  async ({ params, scope }) => {
    assertCanAccessUniversity(scope, params.id);

    const [managers, university, instructorCount] = await Promise.all([
      prisma.manager.findMany({
        where: { universityId: params.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          employeeCode: true,
          user: { select: { name: true, email: true, isActive: true, lastLoginAt: true } },
        },
      }),
      prisma.university.findUnique({
        where: { id: params.id },
        select: { primaryManagerId: true, name: true },
      }),
      prisma.instructor.count({ where: { universityId: params.id, user: { isActive: true } } }),
    ]);

    return NextResponse.json({
      universityName: university?.name ?? null,
      managers: managers.map((m) => ({
        ...m,
        isPrimary: m.id === university?.primaryManagerId,
        // v1 assigns every instructor in the university to its one manager.
        instructorCount,
      })),
    });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
