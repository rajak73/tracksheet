import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { withAuth } from "@/server/http/route";
import { ApiError } from "@/server/http/errors";
import { instructorWhere, narrowManager } from "@/server/auth/scope";
import { assertValidDate } from "@/server/time/schedule-windows";
import { readCanonicalDays, readCanonicalPeriods } from "@/server/insights/canonical";

/**
 * Every insight a roster already has, in one request.
 *
 * ── The bug this exists to fix ────────────────────────────────────────────
 * A manager's sheet passed `canGenerate={false}` to the insight cell, and the
 * cell's mount effect returns early on that flag — so it never fetched at all
 * and every row fell through to the "Pending" fallback. "Pending" was not a
 * generation state; it was the UI saying nobody had asked.
 *
 * ── The same read the instructor's own page does ──────────────────────────
 * `readCanonicalDays` / `readCanonicalPeriods` are what `serveDayInsight` reads
 * through too, so there is one place that decides whether a stored row is the
 * current answer. The first version of this endpoint re-derived that itself and
 * was a second implementation of the same rule — two places to disagree about
 * whether a day is stale, which is how a roster ends up contradicting the page
 * it links to.
 *
 * ── Read-only, and bulk ───────────────────────────────────────────────────
 * Nothing here calls a model, on any path. A roster of twelve hundred people
 * cannot start twelve hundred generations because somebody opened a page, and
 * it does not cost twelve hundred queries either: the roster, the worklog rows
 * and the stored insights are three queries however many people are shown.
 *
 * Authorisation happens before the read and never changes the answer. A missing
 * or stale row is PENDING until somebody permitted to generate it opens the
 * period; a period nobody filed is EMPTY, which is a different thing and says
 * so.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SCOPES = new Set(["DAY", "WEEK", "MONTH"]);

export const GET = withAuth(async ({ scope, req }) => {
  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const scopeType = (sp.get("scope") ?? "").toUpperCase();

  if (!DAY.test(from) || !DAY.test(to) || from > to) {
    throw new ApiError(400, "BAD_RANGE", "Give a from and to date, as YYYY-MM-DD.");
  }
  assertValidDate(from);
  assertValidDate(to);
  if (!SCOPES.has(scopeType)) {
    throw new ApiError(400, "BAD_SCOPE", "`scope` must be DAY, WEEK or MONTH.");
  }

  /* The roster from the SESSION, exactly as `/api/manager/worklog` reads it:
     `narrowManager` pins a manager to their own people and refuses any other,
     and a global scope widens to the network. There is no id a caller could
     send to widen it. */
  const roster = await prisma.instructor.findMany({
    where:
      scope.kind === "global"
        ? { ...instructorWhere(scope), user: { isActive: true } }
        : { ...instructorWhere(scope), ...narrowManager(scope, null), user: { isActive: true } },
    select: { id: true },
  });
  const instructorIds = roster.map((r) => r.id);
  if (instructorIds.length === 0) return NextResponse.json({ insights: {} });

  const read =
    scopeType === "DAY"
      ? await readCanonicalDays({ instructorIds, date: from })
      : await readCanonicalPeriods({
          instructorIds,
          scopeType: scopeType as "WEEK" | "MONTH",
          periodStart: from,
          periodEnd: to,
        });

  /* Shaped for the cell, which reads a period's items one level down — the same
     shape `/api/instructors/[id]/insight` answers with, so the sheet and the
     page hand the component identical data. */
  const insights: Record<string, unknown> = {};
  for (const [instructorId, value] of read) {
    insights[instructorId] =
      scopeType === "DAY" ? value : { status: value.status, insight: value, generated_at: value.generated_at };
  }

  return NextResponse.json({ insights });
});
