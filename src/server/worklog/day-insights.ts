import { prisma } from "@/server/db";
import { toDateOnly } from "@/server/time/workday";
import { DAY_INSIGHT_TYPE } from "@/server/worklog/analysis";

/**
 * Reading back what `analyseDay` stored.
 *
 * ── Why this is a read and never a generate ───────────────────────────────
 * Nothing in here calls a model. An insight exists because a day was recorded
 * and analysed afterwards, or it does not exist yet — and "not yet" is a
 * perfectly good answer for a table to print. Generating on read would put the
 * provider back on a path somebody is waiting on, one page load removed from
 * the write path it was just taken off.
 *
 * ── Shape ─────────────────────────────────────────────────────────────────
 * Both helpers answer with a plain object keyed by whatever the caller's rows
 * are keyed by — a date for one instructor's own log, an instructor id for a
 * roster. That keeps the join in the page, where the rows already are, instead
 * of asking every table to re-fetch per row.
 */

/** One named deliverable, as the reading placed it. Mirrors `analysis.ts`. */
export type AnalysedDeliverable = {
  name: string;
  durationMinutes: number;
  quantity: number | null;
  quantityLabel: string;
};

export type DayInsight = {
  /** The day this is about, YYYY-MM-DD. */
  date: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  summary: string;
  recommendation: string;
  /**
   * What the raw text was taken to MEAN, as lines rather than prose.
   *
   * This is what the AI Insight column shows: the Deliverable column now
   * carries the instructor's own sentence, and this is the reading of it.
   * Empty for an insight stored before the breakdown was captured, in which
   * case the column falls back to `summary`.
   */
  deliverables: AnalysedDeliverable[];
  /** The metric snapshot the sentence was derived from. */
  supportingData: unknown;
};

/**
 * Pulls the breakdown out of the stored JSON.
 *
 * `supportingData` is `Json`, so nothing about its shape is guaranteed by the
 * type system — rows written by earlier versions have no `deliverables` key at
 * all. Every field is checked before it is trusted; anything malformed yields
 * an empty list and the column falls back to the sentence rather than
 * rendering `undefined`.
 */
function deliverablesIn(supportingData: unknown): AnalysedDeliverable[] {
  if (typeof supportingData !== "object" || supportingData === null) return [];
  const raw = (supportingData as { deliverables?: unknown }).deliverables;
  if (!Array.isArray(raw)) return [];

  const out: AnalysedDeliverable[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.name !== "string" || typeof d.durationMinutes !== "number") continue;
    out.push({
      name: d.name,
      durationMinutes: d.durationMinutes,
      quantity: typeof d.quantity === "number" ? d.quantity : null,
      quantityLabel: typeof d.quantityLabel === "string" ? d.quantityLabel : "",
    });
  }
  return out;
}

const SELECT = {
  instructorId: true,
  severity: true,
  title: true,
  summary: true,
  recommendation: true,
  periodStart: true,
  supportingData: true,
} as const;

type Row = {
  instructorId: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  summary: string;
  recommendation: string;
  periodStart: Date;
  supportingData: unknown;
};

const shape = (r: Row): DayInsight => ({
  date: r.periodStart.toISOString().slice(0, 10),
  severity: r.severity,
  title: r.title,
  summary: r.summary,
  recommendation: r.recommendation,
  deliverables: deliverablesIn(r.supportingData),
  supportingData: r.supportingData,
});

/**
 * One instructor's stored readings across a range, keyed by date.
 *
 * For the instructor's own worklog and any per-day table, where each row IS a
 * day and the question is what was found on that day.
 */
export async function dayInsightsByDate(
  instructorId: string,
  from: string,
  to: string,
): Promise<Record<string, DayInsight>> {
  const rows = await prisma.aiInsight.findMany({
    where: {
      instructorId,
      type: DAY_INSIGHT_TYPE,
      periodStart: { gte: toDateOnly(from), lte: toDateOnly(to) },
    },
    select: SELECT,
  });

  const out: Record<string, DayInsight> = {};
  for (const row of rows) {
    const insight = shape(row as Row);
    out[insight.date] = insight;
  }
  return out;
}

/**
 * The key a mixed table joins on: one instructor, one day.
 *
 * A list of activities can span several people and several dates at once, so
 * neither alone identifies the row an insight belongs to.
 */
export const dayInsightKey = (instructorId: string, date: string) => `${instructorId}:${date}`;

/**
 * Stored readings for the (instructor, day) pairs a page of rows actually
 * covers, keyed by {@link dayInsightKey}.
 *
 * Built from the rows the query already returned rather than from a date range
 * the caller passes separately — the two could disagree, and a table showing an
 * insight for a day it is not displaying is worse than showing none.
 *
 * The `IN … AND IN …` is a rectangle over the two lists, so it can match a few
 * pairs nobody asked for. Those are simply never looked up; the alternative is
 * an OR per pair, which for a page of fifty rows is a worse query than a
 * slightly wide one over two indexed columns.
 */
export async function dayInsightsForPairs(
  pairs: Array<{ instructorId: string; date: string }>,
): Promise<Record<string, DayInsight>> {
  if (pairs.length === 0) return {};

  const instructorIds = [...new Set(pairs.map((p) => p.instructorId))];
  const dates = [...new Set(pairs.map((p) => p.date))];

  const rows = await prisma.aiInsight.findMany({
    where: {
      instructorId: { in: instructorIds },
      type: DAY_INSIGHT_TYPE,
      periodStart: { in: dates.map(toDateOnly) },
    },
    select: SELECT,
  });

  const out: Record<string, DayInsight> = {};
  for (const row of rows) {
    if (!row.instructorId) continue;
    const insight = shape(row as Row);
    out[dayInsightKey(row.instructorId, insight.date)] = insight;
  }
  return out;
}

/**
 * Stored readings for several instructors across a date range, keyed by
 * {@link dayInsightKey}.
 *
 * For a sheet showing a PERIOD: the column beside a week of figures has to
 * describe that week. `latestDayInsightByInstructor` answers a different
 * question — "what is the most recent thing known about this person" — which is
 * right for a roster list and wrong here, where it would caption August with a
 * reading of September.
 */
export async function dayInsightsInRange(
  instructorIds: string[],
  from: string,
  to: string,
): Promise<Record<string, DayInsight>> {
  if (instructorIds.length === 0) return {};

  const rows = await prisma.aiInsight.findMany({
    where: {
      instructorId: { in: instructorIds },
      type: DAY_INSIGHT_TYPE,
      periodStart: { gte: toDateOnly(from), lte: toDateOnly(to) },
    },
    select: SELECT,
  });

  const out: Record<string, DayInsight> = {};
  for (const row of rows) {
    if (!row.instructorId) continue;
    const insight = shape(row as Row);
    out[dayInsightKey(row.instructorId, insight.date)] = insight;
  }
  return out;
}

/**
 * The most recent reading for each of several instructors, keyed by instructor.
 *
 * For a roster or a staff list, where a row is a PERSON and the useful answer
 * is the latest thing found about them rather than a particular day's.
 *
 * Ordered oldest first and written into the map as it goes, so the newest row
 * for an instructor is the one that survives. A `DISTINCT ON` would be tighter
 * SQL, but this stays inside Prisma's typed client and these lists are a page
 * of people, not a scan.
 */
export async function latestDayInsightByInstructor(
  instructorIds: string[],
): Promise<Record<string, DayInsight>> {
  if (instructorIds.length === 0) return {};

  const rows = await prisma.aiInsight.findMany({
    where: { instructorId: { in: instructorIds }, type: DAY_INSIGHT_TYPE },
    select: SELECT,
    orderBy: { periodStart: "asc" },
  });

  const out: Record<string, DayInsight> = {};
  for (const row of rows) {
    if (!row.instructorId) continue;
    out[row.instructorId] = shape(row as Row);
  }
  return out;
}
