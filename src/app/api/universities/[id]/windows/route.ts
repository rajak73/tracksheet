import { NextResponse } from "next/server";
import { assertCanAccessUniversity } from "@/server/auth/scope";
import { withAuth } from "@/server/http/route";
import { loadUniversityConfig } from "@/server/universities/config";
import { assertValidDate, computeDayWindows } from "@/server/time/schedule-windows";

/**
 * The computed opening/closing windows and working-day status for one
 * university on one date. This is what Phase 3's activity logging will call to
 * find out when the daily opening and closing are expected.
 *
 * The response carries `opening` and `closing` as single objects, never
 * collections — the shape itself makes "one window per class" unrepresentable.
 */
export const GET = withAuth<{ id: string }>(async ({ scope, params, req }) => {
  assertCanAccessUniversity(scope, params.id);

  const date = req.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json(
      { error: { code: "MISSING_DATE", message: "A ?date=YYYY-MM-DD parameter is required" } },
      { status: 400 },
    );
  }
  assertValidDate(date);

  const config = await loadUniversityConfig(params.id);
  return NextResponse.json({ windows: computeDayWindows(config, date) });
});
