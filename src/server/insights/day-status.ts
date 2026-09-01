import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import {
  buildCanonicalContext,
  contextHash,
  modelId,
  promptVersionFor,
  stableStringify,
  type CanonicalDay,
} from "@/server/insights/context";

/**
 * What the AI Insight cell should show for each day on a page, without
 * generating anything.
 *
 * ── Read-only, by construction ────────────────────────────────────────────
 * There is no generator here to call. A table rendering a column must not be
 * able to start paying for it: a manager scrolling a fortnight would otherwise
 * buy a fortnight of insights, and an instructor paging back through a month
 * would buy a month. Generation happens on the insight endpoint, once, for the
 * period somebody is actually looking at.
 *
 * ── The three states are three different facts ────────────────────────────
 * "No worklog for that date" and "a worklog exists but has no insight yet" look
 * almost identical in a table cell and mean completely different things to
 * somebody reading it: one is a day nobody filed, the other is a day nobody has
 * opened. They are returned as distinct states here so the cell cannot collapse
 * them by accident.
 */

export type DayInsightStatus =
  /** A day row exists and its stored insight still matches it. */
  | { state: "READY"; summary: string; generatedAt: string }
  /** A day row exists; there is no insight, or the stored one has gone stale. */
  | { state: "PENDING" }
  /** Generation failed for this day. The cell shows the raw text and a retry. */
  | { state: "FAILED" };

/**
 * Keyed by `YYYY-MM-DD`. A date absent from the map has no worklog row at all —
 * which the cell renders as an em dash, not as "pending".
 */
export async function dayInsightStatuses(
  instructorId: string,
  from: string,
  to: string,
): Promise<Record<string, DayInsightStatus>> {
  /* One read for the whole range rather than one per day. The context builder
     already returns every day it finds, so the days ARE the query. */
  const context = await buildCanonicalContext({ instructorId, periodStart: from, periodEnd: to });
  if (context.days.length === 0) return {};

  const rows = await prisma.aiInsightCache.findMany({
    where: {
      instructorId,
      scopeType: "DAY",
      periodStart: { gte: toDateOnly(from), lte: toDateOnly(to) },
    },
    select: {
      periodStart: true,
      contextHash: true,
      insightPayload: true,
      status: true,
      generatedAt: true,
    },
  });
  const byDate = new Map(rows.map((r) => [r.periodStart.toISOString().slice(0, 10), r]));

  const promptVersion = promptVersionFor("DAY");
  const model = modelId();
  const out: Record<string, DayInsightStatus> = {};

  for (const day of context.days) {
    const row = byDate.get(day.log_date);
    if (!row) {
      out[day.log_date] = { state: "PENDING" };
      continue;
    }
    if (row.status === "FAILED") {
      out[day.log_date] = { state: "FAILED" };
      continue;
    }

    /* The day's own canonical context — the same shape `serveInsight` hashes for
       a DAY scope, so this cell and that endpoint agree about staleness. If they
       disagreed, a cell would say READY and the endpoint would regenerate, or
       worse the other way round. */
    const hash = contextHash(canonicalDay(day), promptVersion, model);
    const payload = row.insightPayload as { summary?: unknown } | null;
    const summary = typeof payload?.summary === "string" ? payload.summary : "";

    out[day.log_date] =
      row.status === "READY" && row.contextHash === hash && summary !== ""
        ? { state: "READY", summary, generatedAt: row.generatedAt.toISOString() }
        : { state: "PENDING" };
  }

  return out;
}

/**
 * One day, serialised exactly as a DAY-scoped context would be.
 *
 * Built here rather than by calling the builder once per day: that would be one
 * database round trip per row on the page, for a value already in hand.
 */
function canonicalDay(day: CanonicalDay): string {
  return stableStringify({
    period_start: day.log_date,
    period_end: day.log_date,
    days: [day],
  });
}
