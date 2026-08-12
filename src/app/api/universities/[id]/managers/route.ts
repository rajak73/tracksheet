import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { logAudit } from "@/server/audit/logger";
import { provisionManager } from "@/server/users/provision";

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


const CreateManager = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(200),
  password: z.string().min(12).max(1024),
  employeeCode: z.string().max(64).optional(),
});

/**
 * Creates a manager for this university. Admin-only: a manager creating
 * another manager would be granting their own level of access, and v1 has one
 * primary manager per university.
 *
 * A 12-character minimum on the initial password because it is set by someone
 * else and travels out-of-band before the account owner changes it.
 */
export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const input = CreateManager.parse(await req.json().catch(() => null));
    assertCanAccessUniversity(scope, params.id);

    // Confirms the university exists before creating an account bound to it.
    await prisma.university.findUniqueOrThrow({ where: { id: params.id }, select: { id: true } });

    const result = await provisionManager({ ...input, universityId: params.id });

    await logAudit(principal, scope, {
      action: "MANAGER_ASSIGNED",
      entityType: "Manager",
      entityId: result.manager.id,
      metadata: { universityId: params.id, isPrimary: result.isPrimary },
    });

    return NextResponse.json(
      { manager: { ...result.manager, user: result.user, isPrimary: result.isPrimary } },
      { status: 201 },
    );
  },
  { roles: ["ADMIN"] },
);
