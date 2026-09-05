/**
 * The canonical insight, read.
 *
 * ── One source, whoever is asking ─────────────────────────────────────────
 * An insight belongs to the person whose worklog it summarises, not to the
 * viewer. So there is one stored row per person and period, and this is the one
 * place that decides whether that row is the current answer and what it says.
 *
 * Everything that displays an insight reads through here: the instructor's own
 * page, the manager's roster, the admin's. Their difference is authorisation,
 * decided before this is called, and never the answer.
 *
 * ── Why the bulk shape is the primary one ─────────────────────────────────
 * A roster of twelve hundred people has to cost the same number of queries as a
 * roster of one. Both entry points below take a LIST and answer with a map; the
 * single-instructor callers pass a list of one. Written the other way round —
 * a singular function and a loop — the roster becomes a query per row, which is
 * exactly the defect this replaced.
 *
 * Nothing here calls a model, on any path. A row that is missing or stale comes
 * back as PENDING and stays that way until somebody permitted to generate it
 * opens the period. That is the generation matrix working, not a failure.
 */
import { prisma } from "@/server/db";
import {
  buildCanonicalContexts,
  canonicalJson,
  contextHash,
  modelId,
  promptVersionFor,
  PROMPT_VERSION_EXTRACT,
  type ScopeType,
} from "./context";
import type { InsightItem } from "./worklog-summary";

/**
 * Why a stored answer is not being shown.
 *
 * `EMPTY` is a day or period nobody filed — there is nothing to summarise, and
 * a cell promising an insight for it would be promising something that is never
 * coming. `PENDING` is work that exists and has no current insight yet.
 */
export type InsightStatus = "READY" | "PENDING" | "FAILED" | "EMPTY";

export type CanonicalDayInsight = {
  status: InsightStatus;
  items: InsightItem[];
  total_minutes: number;
  raw_text: string | null;
  cached: boolean;
  generated_at: string | null;
  last_error: string | null;
  failure_kind: "structure" | "provider" | null;
};

export type CanonicalPeriodInsight = {
  status: InsightStatus;
  items: InsightItem[];
  total_minutes: number;
  days_logged: number;
  cached: boolean;
  generated_at: string | null;
};

/** The stored items, read back defensively — the column is JSON. */
export function readItems(value: unknown): InsightItem[] {
  if (!Array.isArray(value)) return [];
  const out: InsightItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const v = raw as Record<string, unknown>;
    if (typeof v.activity !== "string" || v.activity.trim() === "") continue;
    const list = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((y): y is string => typeof y === "string") : [];
    out.push({
      activity: v.activity,
      action: typeof v.action === "string" ? v.action : null,
      subject: typeof v.subject === "string" ? v.subject : null,
      topics: list(v.topics),
      subtopics: list(v.subtopics),
      durationMinutes: typeof v.durationMinutes === "number" ? v.durationMinutes : 0,
      ...(typeof v.sourceText === "string" ? { sourceText: v.sourceText } : {}),
      ...(typeof v.sourceIndex === "number" ? { sourceIndex: v.sourceIndex } : {}),
    });
  }
  return out;
}

/**
 * The stored DAILY insight for each of these people, on this date.
 *
 * Three queries whatever the roster size: the days themselves (for the hash and
 * to tell "nobody filed" from "not summarised yet"), and the stored rows.
 */
export async function readCanonicalDays(input: {
  instructorIds: string[];
  date: string;
}): Promise<Map<string, CanonicalDayInsight>> {
  const out = new Map<string, CanonicalDayInsight>();
  if (input.instructorIds.length === 0) return out;

  const [contexts, rows] = await Promise.all([
    buildCanonicalContexts({
      instructorIds: input.instructorIds,
      periodStart: input.date,
      periodEnd: input.date,
    }),
    prisma.dayExtraction.findMany({
      where: { instructorId: { in: input.instructorIds }, logDate: new Date(`${input.date}T00:00:00.000Z`) },
    }),
  ]);
  const stored = new Map(rows.map((row) => [row.instructorId, row]));
  const version = PROMPT_VERSION_EXTRACT;
  const model = modelId();

  for (const instructorId of input.instructorIds) {
    const context = contexts.get(instructorId);
    const day = context?.days[0];

    /* Nobody filed this day. Not pending: there is nothing to summarise, and a
       cell showing Pending is a promise that something is coming. */
    if (!day) {
      out.set(instructorId, {
        status: "EMPTY",
        items: [],
        total_minutes: 0,
        raw_text: null,
        cached: false,
        generated_at: null,
        last_error: null,
        failure_kind: null,
      });
      continue;
    }

    const expected = contextHash(canonicalJson(context!), version, model);
    const row = stored.get(instructorId);
    const current = row?.sourceHash === expected;

    out.set(instructorId, {
      status: current ? (row!.status as InsightStatus) : "PENDING",
      items: current && row!.status === "READY" ? readItems(row!.items) : [],
      total_minutes: day.working_minutes ?? 0,
      raw_text: day.deliverable,
      cached: Boolean(current),
      generated_at: current ? row!.generatedAt.toISOString() : null,
      last_error: current ? row!.lastError : null,
      failure_kind:
        current && row!.status === "FAILED"
          ? ((row!.failureKind as "structure" | "provider" | null) ?? "structure")
          : null,
    });
  }
  return out;
}

/** The stored WEEK or MONTH insight for each of these people, over this range. */
export async function readCanonicalPeriods(input: {
  instructorIds: string[];
  scopeType: Exclude<ScopeType, "DAY">;
  periodStart: string;
  periodEnd: string;
}): Promise<Map<string, CanonicalPeriodInsight>> {
  const out = new Map<string, CanonicalPeriodInsight>();
  if (input.instructorIds.length === 0) return out;

  const [contexts, rows] = await Promise.all([
    buildCanonicalContexts({
      instructorIds: input.instructorIds,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }),
    prisma.aiInsightCache.findMany({
      where: {
        instructorId: { in: input.instructorIds },
        scopeType: input.scopeType,
        periodStart: new Date(`${input.periodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${input.periodEnd}T00:00:00.000Z`),
      },
    }),
  ]);
  const stored = new Map(rows.map((row) => [row.instructorId, row]));
  const version = promptVersionFor(input.scopeType);
  const model = modelId();

  for (const instructorId of input.instructorIds) {
    const context = contexts.get(instructorId);
    const days = context?.days ?? [];
    const totalMinutes = days.reduce((n, d) => n + (d.working_minutes ?? 0), 0);

    if (days.length === 0) {
      out.set(instructorId, {
        status: "EMPTY",
        items: [],
        total_minutes: 0,
        days_logged: 0,
        cached: false,
        generated_at: null,
      });
      continue;
    }

    const expected = contextHash(canonicalJson(context!), version, model);
    const row = stored.get(instructorId);
    const current = row?.contextHash === expected;
    const payload = current ? (row!.insightPayload as { items?: unknown } | null) : null;

    out.set(instructorId, {
      status: current ? (row!.status as InsightStatus) : "PENDING",
      items: current && row!.status === "READY" ? readItems(payload?.items) : [],
      total_minutes: totalMinutes,
      days_logged: days.length,
      cached: Boolean(current),
      generated_at: current ? row!.generatedAt.toISOString() : null,
    });
  }
  return out;
}
