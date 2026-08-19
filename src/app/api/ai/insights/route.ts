import { NextResponse } from "next/server";
import { withAuth } from "@/server/http/route";
import { logAudit } from "@/server/audit/logger";
import { assistantInsight, type UnavailableReason } from "@/server/ai/assistant";

/**
 * The one AI endpoint. An admin, a manager and an instructor all call exactly
 * this URL, with no parameters, and each receives an insight about their own
 * scope.
 *
 * ── There is nothing here to tamper with ───────────────────────────────────
 * The route takes no `universityId`, no `managerId` and no `instructorId`.
 * Audience and subject are derived from `scope`, which `withAuth` builds from
 * the session. That is the whole authorisation story: a manager cannot request
 * a colleague's brief because there is no field in which to name one, and
 * adding one later would be a visible change to this file rather than a quiet
 * widening somewhere downstream.
 *
 * ── One call per dashboard, not one per row ────────────────────────────────
 * The service performs at most one provider call, and none when the underlying
 * figures are unchanged since a cached reply. This route is meant to be
 * fetched once when a dashboard loads. `?refresh=1` bypasses the cache for a
 * deliberate user action, and is the only reason a repeat visit costs a call.
 *
 * ── Unavailable is a 200 ───────────────────────────────────────────────────
 * A missing key or an unverifiable reply is not a client error and not a
 * server fault: it is a working response saying this optional feature has
 * nothing trustworthy to show. The card renders a plain notice; the dashboard
 * around it is unaffected.
 */

/** User-facing text for each reason. No provider detail ever reaches these. */
const NOTICE: Record<UnavailableReason, string> = {
  not_configured: "AI insights are not configured on this deployment.",
  no_data: "There is not enough recorded activity yet to summarise.",
  provider_unavailable: "AI insights are temporarily unavailable. Try again shortly.",
  unverified:
    "An AI summary was generated but could not be verified against your figures, so it was discarded.",
};

export const GET = withAuth(async ({ principal, scope, req }) => {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const outcome = await assistantInsight(scope, { refresh });

  // Audited through the existing audit system, like any other meaningful
  // action. What is recorded is that a request happened, its audience and its
  // outcome — never the generated text, which is already stored as an insight
  // and would only be duplicated here.
  await logAudit(principal, scope, {
    action: "AI_INSIGHT_REQUESTED",
    entityType: "AiInsight",
    metadata: outcome.available
      ? { audience: outcome.audience, cached: outcome.cached, period: outcome.period }
      : { available: false, reason: outcome.reason },
  });

  if (!outcome.available) {
    return NextResponse.json({
      insight: null,
      available: false,
      reason: outcome.reason,
      notice: NOTICE[outcome.reason],
    });
  }

  return NextResponse.json({
    available: true,
    insight: {
      audience: outcome.audience,
      period: outcome.period,
      generatedAt: outcome.generatedAt.toISOString(),
      cached: outcome.cached,
      recommendations: outcome.reply.recommendations,
    },
  });
}, { roles: ["ADMIN", "MANAGER", "INSTRUCTOR"] });
