import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { logAudit } from "@/server/audit/logger";
import { provisionManager } from "@/server/users/provision";
import { computeAnalytics } from "@/server/analytics/engine";
import { currentWeekFor } from "@/server/analytics/roster";

/**
 * Managers of a university — the level the admin drill-down was missing
 * (university -> MANAGER -> instructor -> date -> activity).
 *
 * Every manager carries their OWN roster size and their OWN current-week
 * figures. This used to hand the same university-wide count to each of them,
 * which was wrong the moment a university had two managers: the drill-down
 * promised distinct teams and the numbers said otherwise.
 *
 * The current-week figures come from `computeAnalytics` — the same engine the
 * dashboards and the tracker use — so a manager's hours here and their hours in
 * the tracker cannot disagree. One call per manager, each covering one week,
 * plus one grouped count; managers per university are single digits.
 */
export const GET = withAuth<{ id: string }>(
  async ({ params, scope }) => {
    assertCanAccessUniversity(scope, params.id);

    // The WHOLE ISO week in the university's own zone. This used to be
    // `mondayOf(today)` used as both bounds, so every figure below covered
    // MONDAY and was published as the week: on a Thursday a manager whose
    // roster had recorded four full days showed only the first of them.
    // `currentWeekFor` is the one definition of this period — see roster.ts.
    const week = await currentWeekFor(params.id);

    const [managers, university, rosterCounts, unassignedCount] = await Promise.all([
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
        select: { primaryManagerId: true, name: true, code: true },
      }),
      // One grouped query for every roster size, rather than one count each.
      prisma.instructor.groupBy({
        by: ["managerId"],
        where: { universityId: params.id, user: { isActive: true } },
        _count: { _all: true },
      }),
      prisma.instructor.count({
        where: { universityId: params.id, managerId: null, user: { isActive: true } },
      }),
    ]);

    const sizeOf = new Map(rosterCounts.map((r) => [r.managerId, r._count._all]));

    const weekly = await Promise.all(
      managers.map((m) =>
        computeAnalytics({
          universityId: params.id,
          from: week.from,
          to: week.to,
          managerId: m.id,
        }),
      ),
    );

    return NextResponse.json({
      universityName: university?.name ?? null,
      universityCode: university?.code ?? null,
      currentWeek: week,
      // Instructors nobody leads yet. Surfaced rather than hidden: they are
      // real people doing real work, and an admin needs to see who still needs
      // placing instead of discovering them missing from every roster.
      unassignedInstructors: unassignedCount,
      managers: managers.map((m, i) => {
        const a = weekly[i]!;
        return {
          ...m,
          isPrimary: m.id === university?.primaryManagerId,
          instructorCount: sizeOf.get(m.id) ?? 0,
          currentWeekWorkingHours: a.totals.productiveHours,
          currentWeekDeliverables: a.totals.deliverables.completedQuantity,
          currentWeekUtilization: a.totals.utilizationPct,
        };
      }),
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
      universityId: params.id,
      metadata: { universityId: params.id, isPrimary: result.isPrimary },
    });

    return NextResponse.json(
      { manager: { ...result.manager, user: result.user, isPrimary: result.isPrimary } },
      { status: 201 },
    );
  },
  { roles: ["ADMIN"] },
);
