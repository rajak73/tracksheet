import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { computeAnalytics } from "@/server/analytics/engine";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";

/**
 * One endpoint, all three roles. Admin and manager see the whole university;
 * an instructor's `self` scope narrows the engine to their own records, so the
 * same route serves the personal dashboard without a second implementation.
 */
export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  assertCanAccessUniversity(scope, params.id);

  const config = await loadUniversityConfig(params.id);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);

  const analytics = await computeAnalytics({
    universityId: params.id,
    from: period.from,
    to: period.to,
    instructorId: scope.kind === "self" ? scope.instructorId : undefined,
  });

  return NextResponse.json({ analytics });
});
