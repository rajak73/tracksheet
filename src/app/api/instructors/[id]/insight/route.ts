import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { serveInsight } from "@/server/insights/cache";
import { generateInsight } from "@/server/insights/generate";
import type { ScopeType } from "@/server/insights/context";

/**
 * The insight for one instructor over one period.
 *
 * ── Lazy, and only here ───────────────────────────────────────────────────
 * This is the only place an insight is generated. Opening a view asks for one;
 * nothing else does — not a write, not a schedule, not a warm-up. A period
 * nobody opens is never paid for.
 *
 * Whether a provider call happens is decided entirely by `serveInsight`, from
 * the hash of the data. This route does not know and does not need to.
 *
 * ── Who may ask ───────────────────────────────────────────────────────────
 * `assertCanReadInstructorWork` — the same check every other reading of one
 * person's work uses. An insight is a description of their logs, so it is
 * exactly as sensitive as the logs, and an off-roster id answers 404 like an
 * unknown one.
 */

const SCOPES = new Set<ScopeType>(["DAY", "WEEK", "MONTH"]);

export const GET = withAuth<{ id: string }>(async ({ scope: tenant, params, req }) => {
  const instructor = await prisma.instructor.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      universityId: true,
      managerId: true,
      university: { select: { primaryManagerId: true } },
    },
  });
  if (!instructor) throw new ApiError(404, "NOT_FOUND", "Instructor not found");
  assertCanReadInstructorWork(tenant, instructor, instructor.university.primaryManagerId);

  const sp = req.nextUrl.searchParams;
  const scopeType = (sp.get("scope") ?? "").toUpperCase() as ScopeType;
  if (!SCOPES.has(scopeType)) {
    throw new ApiError(400, "BAD_SCOPE", "`scope` must be DAY, WEEK or MONTH.");
  }

  const periodStart = sp.get("from") ?? "";
  const periodEnd = sp.get("to") ?? "";
  assertValidDate(periodStart);
  assertValidDate(periodEnd);
  if (periodStart > periodEnd) {
    throw new ApiError(400, "INVALID_PERIOD", "`from` must not be after `to`.");
  }

  const result = await serveInsight(
    { instructorId: instructor.id, scopeType, periodStart, periodEnd },
    generateInsight,
  );

  /* The contract the client reads. Hashes, prompt versions and model ids are
     deliberately absent: they are how the cache decides, not anything a person
     looking at their work should have to see. */
  return NextResponse.json(result);
});
