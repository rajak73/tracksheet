import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { assertCanAccessUniversity, narrowManager } from "@/server/auth/scope";
import { computeAnalytics } from "@/server/analytics/engine";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";
import { latestDayInsightByInstructor } from "@/server/worklog/day-insights";

/**
 * One endpoint, all three roles, each seeing what their role covers.
 *
 * An instructor's `self` scope narrows the engine to their own records, so the
 * same route serves the personal dashboard without a second implementation.
 *
 * ── A manager sees their roster, not the tenant ───────────────────────────
 * This used to say "admin and manager see the whole university", and the engine
 * returns PER-INSTRUCTOR rows — so a manager read every colleague's individual
 * figures here, while `/tracker` narrowed exactly the same data with
 * `narrowManager` and `/reports` was corrected to do the same. Three endpoints
 * over one engine gave three different answers to "whose numbers may I see",
 * which is not a boundary.
 *
 * `narrowManager` is the authority: an admin gets `{}` and still sees
 * everything, a manager gets their own id and cannot ask for another's.
 */
export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  assertCanAccessUniversity(scope, params.id);
  const roster = narrowManager(scope, req.nextUrl.searchParams.get("managerId"));

  const config = await loadUniversityConfig(params.id);
  const period = resolvePeriod(req.nextUrl.searchParams, config.timezone);

  const analytics = await computeAnalytics({
    universityId: params.id,
    from: period.from,
    to: period.to,
    instructorId: scope.kind === "self" ? scope.instructorId : undefined,
    managerId: roster.managerId,
    // Opt-in: computing the comparison period doubles the query cost, so it is
    // only paid for when a caller asks for trends.
    includeTrend: req.nextUrl.searchParams.get("trend") === "1",
  });

  /* The stored reading for each instructor the breakdown covers, so a screen
     can put the raw figures first and the AI summary in a column beside them
     rather than the other way round. A read, never a generate — see
     `day-insights`. */
  const insights = await latestDayInsightByInstructor(
    analytics.instructors.map((i) => i.instructorId),
  );

  return NextResponse.json({ analytics, insights });
});
