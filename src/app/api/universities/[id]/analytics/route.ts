import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { worklogFigures } from "@/server/analytics/worklog-figures";
import { assertCanAccessUniversity, narrowManager } from "@/server/auth/scope";
import { computeAnalytics } from "@/server/analytics/engine";
import { resolvePeriod } from "@/server/analytics/period";
import { loadUniversityConfig } from "@/server/universities/config";

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

  /* ── What replaced the allocation bar ──────────────────────────────────
   * The page showed "how capacity was allocated" as a bar split by activity
   * type, across every instructor in the period. Those slices needed a shared
   * vocabulary to add up: one person writes "Java class", the next "lecture",
   * and a bar that sums them states an agreement that does not exist.
   *
   * These three need none. Read from `WorklogEntry`, no model call, always
   * available — see `worklogFigures`. Coverage is the one that was missing:
   * "412 hours" says nothing about whether anybody failed to file, and
   * "38 of 45 instructor-days logged" says exactly that. */
  const figures = await worklogFigures(
    analytics.instructors.map((i) => i.instructorId),
    period.from,
    period.to,
  );

  return NextResponse.json({
    analytics,
    figures: {
      ...figures,
      /* The denominator coverage is measured against: instructor-days the
         period could hold. Sent rather than derived in the browser, so the
         screen and any export divide by the same number. */
      instructorDays: analytics.instructors.reduce((n, i) => n + i.expectedWorkingDays, 0),
    },
  });
});
