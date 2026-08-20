import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertCanManageInstructor, assertCanReadInstructor } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { z } from "zod";
import { logAudit } from "@/server/audit/logger";
import { parseLimit, parsePage } from "@/server/http/params";

const createDeliverableSchema = z.object({
  title: z.string().min(1).max(300),
  // Free text, not an enum: categories are decided per university (e.g.
  // "Teaching", "Research"), not a fixed set this schema should own.
  category: z.string().min(1).max(100).optional(),
  targetQuantity: z.number().int().min(1),
  targetHours: z.number().min(0.5),
  // Shape AND reality: the regex alone admits 2045-13-45. The Invalid Date
  // check must come FIRST — `.toISOString()` on an Invalid Date throws, so a
  // refine that calls it unconditionally turns the very input it exists to
  // reject into a 500 (the first version of this fix did exactly that).
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
    .refine((d) => {
      const parsed = new Date(`${d}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
    }, "Must be a real calendar date"),
});

/** Resolves the target instructor and authorises the caller against them. */
async function requireVisibleInstructor(
  scope: Parameters<typeof assertCanReadInstructor>[0],
  instructorId: string,
) {
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });

  if (!instructor) {
    throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  }

  // assertCanReadInstructor, NOT assertCanAccessUniversity: the latter only
  // compares the tenant, so a self-scoped caller would pass for any colleague
  // in their own university.
  assertCanReadInstructor(scope, instructor);
  return instructor;
}

export const GET = withAuth<{ id: string }>(async ({ params, scope, req }) => {
  const instructor = await requireVisibleInstructor(scope, params.id);

  const { searchParams } = new URL(req.url);
  const page = parsePage(searchParams.get("page"));
  const limit = parseLimit(searchParams.get("limit"), { fallback: 50, max: 200 });
  const where = { instructorId: instructor.id };

  const [deliverables, total] = await Promise.all([
    prisma.deliverable.findMany({
      where,
      include: { logs: { orderBy: { workDate: "asc" } } },
      orderBy: { dueDate: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deliverable.count({ where }),
  ]);

  return NextResponse.json({ deliverables, page, limit, total, hasMore: page * limit < total });
});

/**
 * Assigning work is a management action, so instructors cannot create
 * deliverables — not even on themselves. The role gate runs in withAuth, and
 * the tenant/ownership check still runs below for managers.
 */
/**
 * The write-level check.
 *
 * `loadInstructor` above asks "may you see this person", which for a manager is
 * a tenant comparison. Writing is a different question: a manager runs ONE
 * roster, so acting on a peer's instructor is out of bounds even inside their
 * own university. Unassigned instructors fall to the primary manager, the same
 * rule the roster and the approval queue use.
 */
function assertWritable(scope: Parameters<typeof assertCanManageInstructor>[0], instructor: {
  id: string;
  universityId: string;
  managerId: string | null;
  university: { primaryManagerId: string | null };
}) {
  assertCanManageInstructor(scope, instructor, instructor.university.primaryManagerId);
}

export const POST = withAuth<{ id: string }>(
  async ({ params, req, scope, principal }) => {
    const data = createDeliverableSchema.parse(await req.json().catch(() => null));
    const instructor = await requireVisibleInstructor(scope, params.id);
    assertWritable(scope, instructor);

    const deliverable = await prisma.deliverable.create({
      data: {
        instructorId: instructor.id,
        universityId: instructor.universityId,
        title: data.title,
        category: data.category,
        targetQuantity: data.targetQuantity,
        targetHours: data.targetHours,
        dueDate: new Date(data.dueDate),
      },
    });

    await logAudit(principal, scope, {
      action: "DELIVERABLE_CREATED",
      entityType: "Deliverable",
      entityId: deliverable.id,
      universityId: instructor.universityId,
      metadata: { instructorId: instructor.id, title: data.title },
    });

    return NextResponse.json({ deliverable }, { status: 201 });
  },
  { roles: ["ADMIN", "MANAGER"] },
);
