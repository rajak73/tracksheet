import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity, narrowManager } from "@/server/auth/scope";
import { detectExceptions, EXCEPTION_TYPES, type ExceptionType } from "@/server/analytics/exceptions";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";

/**
 * Data-quality exceptions for a university and period.
 *
 * One endpoint, all three roles — identical to every other tenant-scoped route.
 * Admin and manager see the whole university; an instructor's `self` scope
 * narrows it to their own records, so there is no separate instructor variant
 * that could drift.
 */
export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  assertCanAccessUniversity(scope, params.id);

  /* ── The roster, not the tenant ─────────────────────────────────────────
   * This listed every instructor in the university to any manager, along with
   * their names and ids. Two costs: it is the same personal-work read the
   * per-instructor routes now refuse, and it was the practical way to LEARN a
   * peer manager's instructor ids, which every other boundary then assumes the
   * caller does not have. */
  const roster = narrowManager(scope, req.nextUrl.searchParams.get("managerId"));

  const config = await loadUniversityConfig(params.id);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);

  // Optional ?types=A,B filter, validated against the known set so an unknown
  // value is a clear 400 rather than a silently empty result.
  const raw = req.nextUrl.searchParams.get("types");
  let types: ExceptionType[] | undefined;
  if (raw) {
    const requested = raw.split(",").map((t) => t.trim()).filter(Boolean);
    const unknown = requested.filter((t) => !EXCEPTION_TYPES.includes(t as ExceptionType));
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: {
            code: "UNKNOWN_EXCEPTION_TYPE",
            message: `Unknown exception type(s): ${unknown.join(", ")}`,
            details: { known: EXCEPTION_TYPES },
          },
        },
        { status: 400 },
      );
    }
    types = requested as ExceptionType[];
  }

  const result = await detectExceptions({
    universityId: params.id,
    from: period.from,
    to: period.to,
    instructorId: scope.kind === "self" ? scope.instructorId : undefined,
    managerId: roster.managerId,
    types,
  });

  return NextResponse.json({ exceptions: result });
});
