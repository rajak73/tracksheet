import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { assertCanReadInstructorWork } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { assertValidDate } from "@/server/time/schedule-windows";
import { serveInsight } from "@/server/insights/cache";
import { resolveViewerRole } from "@/server/insights/access";
import { serveDayInsight } from "@/server/insights/serve-day";
import { buildPeriodRollup } from "@/server/insights/period-rollup";
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

  /* From the SESSION's scope and the instructor being asked about — never from
     anything the caller sent. A role the caller can state is not a role. */
  const viewerRole = resolveViewerRole(tenant, instructor.id);

  /* ── A day is extracted; a period is grouped ────────────────────────────
   * Two different questions with two different stores. A day's answer is a
   * reading of that day's own text and lives in `DayExtraction`; a period's is
   * a grouping of what those days held and lives in the insight cache. Routing
   * both through one store would key one answer by two hashes. */
  if (scopeType === "DAY") {
    if (periodStart !== periodEnd) {
      throw new ApiError(400, "INVALID_PERIOD", "A DAY scope covers one date.");
    }
    return NextResponse.json(
      await serveDayInsight({ instructorId: instructor.id, date: periodStart, viewerRole }),
    );
  }

  const result = await serveInsight(
    { instructorId: instructor.id, scopeType, periodStart, periodEnd },
    viewerRole,
    /* The generator runs only when nothing valid is stored, and only for a
       viewer permitted to generate — `serveInsight` decides both before this is
       reached. Every figure in the payload is summed in code. */
    async () => {
      const built = await buildPeriodRollup({
        instructorId: instructor.id,
        periodStart,
        periodEnd,
      });
      /* Throwing rather than returning a partial payload: `serveInsight` treats
         a throw as "keep whatever was stored and mark it stale", and a rollup
         whose parts do not add to its whole must never be stored. */
      if (!built.ok) throw new Error(built.reason);
      return built.rollup;
    },
  );

  /* The contract the client reads. Hashes, prompt versions and model ids are
     deliberately absent: they are how the cache decides, not anything a person
     looking at their work should have to see. */
  return NextResponse.json(result);
});
