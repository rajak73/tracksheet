/**
 * The day insight: extracted points, served from storage wherever possible.
 *
 * ── Why this is not `serveInsight` ────────────────────────────────────────
 * `serveInsight` caches a generated PAYLOAD against a context hash, which is
 * the right shape for a week's grouping. A day's answer is not generated prose
 * at all — it is an extraction of the day's own text, and it already has a
 * table of its own with its own hash, its own status and its own record of
 * which check refused it. Routing days through the insight cache as well would
 * store one answer in two places, keyed by two hashes, and the day the two
 * disagree the screen shows whichever was read first.
 *
 * So the day path is the same shape as `serveInsight` — cache first, then the
 * read-only gate, then a single-flight generation — over `DayExtraction`.
 */
import { prisma } from "@/server/db";
import {
  buildCanonicalContext,
  canonicalJson,
  contextHash,
  modelId,
  PROMPT_VERSION_EXTRACT,
} from "./context";
import { generationModeFor, type ViewerRole } from "./access";
import { serveDayExtraction } from "./extract";
import type { DayText } from "./extraction-checks";
import { parseActivities } from "@/domain/worklog-activities";
import { renderDaySummary, type SummaryActivity } from "@/domain/summary-render";
import { toDateOnly } from "@/server/time/workday";

/** One extracted point, as a day cell renders it. */
export type DayPoint = {
  label: string;
  sessions: number | null;
  /** The noun the count is in — `classes`, `submissions`. */
  sessions_unit?: string | null;
  /** Whole minutes, or null when the text stated no duration. */
  minutes: number | null;
};

export type ServedDayInsight = {
  scope: { type: "DAY"; period_start: string; period_end: string };
  points: DayPoint[];
  /**
   * The day in words — one sentence, assembled here.
   *
   * Every figure in it comes from the rows the instructor filled in. The model
   * supplied the labels and not one number among them.
   */
  summary_lines: string[];
  /** Minutes the day recorded that no point could account for. */
  unallocated_minutes: number;
  total_minutes: number;
  /** The day's own words. Rendered as-is when status is FAILED. */
  raw_text: string | null;
  cached: boolean;
  generated_at: string | null;
  status: "READY" | "PENDING" | "FAILED" | "EMPTY";
  /** Which check refused it. Null unless FAILED. */
  last_error: string | null;
  /**
   * Which side failed. Null unless FAILED.
   *
   * The screen shows different things for the two, and neither of them is what
   * it shows for a day that extracted cleanly with numbers it could not
   * attribute — that day is not a failure at all.
   */
  failure_kind: "structure" | "provider" | null;
};

const empty = (date: string): ServedDayInsight => ({
  scope: { type: "DAY", period_start: date, period_end: date },
  points: [],
  unallocated_minutes: 0,
  total_minutes: 0,
  raw_text: null,
  summary_lines: [],
  cached: false,
  generated_at: null,
  status: "EMPTY",
  last_error: null,
  failure_kind: null,
});

/**
 * The day's sentence, written here from the points and the recorded total.
 *
 * This is where the arithmetic lives, and it is the whole reason the model is
 * never asked for prose: every figure the reader sees is computed from the
 * record on the way to the screen, so a count can never claim something the
 * rows do not say — and it cannot go stale, because nothing about it is stored.
 */
function daySentence(points: DayPoint[], totalMinutes: number): string[] {
  if (points.length === 0) return [];
  const activities: SummaryActivity[] = points.map((p) => ({
    label: p.label,
    qty: p.sessions,
    unit: p.sessions_unit ?? null,
    minutes: p.minutes,
  }));
  return [renderDaySummary(activities, totalMinutes)];
}

export async function serveDayInsight(input: {
  instructorId: string;
  date: string;
  viewerRole: ViewerRole;
  /** Injected by tests so calls can be counted without a provider. */
  call?: (instruction: string) => Promise<{ ok: true; text: string } | { ok: false; reason: string }>;
}): Promise<ServedDayInsight> {
  const context = await buildCanonicalContext({
    instructorId: input.instructorId,
    periodStart: input.date,
    periodEnd: input.date,
  });

  /* No worklog row is not "pending": there is nothing to extract, and a cell
     showing Pending for a day nobody filed is a promise that something is
     coming. */
  const row = context.days[0];
  if (!row) return empty(input.date);

  const day: DayText = {
    deliverable: row.deliverable ?? "",
    deliverableQuantity: row.deliverable_quantity,
    workingMinutes: row.working_minutes ?? 0,
    // Present only on a day the instructor entered as rows. Its presence is
    // what turns off the checks that exist to attribute numbers to text.
    activities: parseActivities(row.activities),
  };
  const sourceHash = contextHash(canonicalJson(context), PROMPT_VERSION_EXTRACT, modelId());
  const logDate = toDateOnly(input.date);

  const stored = await prisma.dayExtraction.findUnique({
    where: { instructorId_logDate: { instructorId: input.instructorId, logDate } },
  });

  const base = {
    scope: { type: "DAY" as const, period_start: input.date, period_end: input.date },
    total_minutes: day.workingMinutes,
    raw_text: day.deliverable,
  };

  /* ── The only path that costs nothing ─────────────────────────────────── */
  if (stored && stored.sourceHash === sourceHash && stored.status === "READY") {
    return {
      ...base,
      points: stored.items as DayPoint[],
      summary_lines: daySentence(stored.items as DayPoint[], day.workingMinutes),
      unallocated_minutes: stored.unallocatedMinutes,
      cached: true,
      generated_at: stored.generatedAt.toISOString(),
      status: "READY",
      last_error: null,
      failure_kind: null,
    };
  }

  /* A stored FAILURE for THIS text is served rather than retried on every open.
     The retry is a control the instructor presses, not something a page load
     does on their behalf — otherwise a day that cannot be extracted is paid for
     once per view, forever. */
  if (stored && stored.sourceHash === sourceHash && stored.status === "FAILED") {
    return {
      ...base,
      points: [],
      summary_lines: [],
      unallocated_minutes: stored.unallocatedMinutes,
      cached: true,
      generated_at: stored.generatedAt.toISOString(),
      status: "FAILED",
      last_error: stored.lastError,
      failure_kind: (stored.failureKind as "structure" | "provider" | null) ?? "structure",
    };
  }

  /* ── Read-only, so this is where it stops ─────────────────────────────────
   * A manager's day. Nothing stored matches, and the answer is PENDING — not
   * the stale extraction, which describes text that has since changed. No call
   * and no write, on any path, including a page-load batch. */
  if (generationModeFor(input.viewerRole, "DAY") === "READ_ONLY") {
    return {
      ...base,
      points: [],
      summary_lines: [],
      unallocated_minutes: day.workingMinutes,
      cached: false,
      generated_at: null,
      status: "PENDING",
      last_error: null,
      failure_kind: null,
    };
  }

  const fresh = await serveDayExtraction({
    instructorId: input.instructorId,
    logDate,
    day,
    sourceHash,
    call: input.call,
  });

  return {
    ...base,
    points: fresh.status === "READY" ? (fresh.items as DayPoint[]) : [],
    summary_lines:
      fresh.status === "READY" ? daySentence(fresh.items as DayPoint[], day.workingMinutes) : [],
    unallocated_minutes: fresh.unallocatedMinutes,
    cached: false,
    generated_at: fresh.generatedAt.toISOString(),
    status: fresh.status,
    last_error: fresh.lastError,
    failure_kind:
      fresh.status === "FAILED"
        ? ((fresh.failureKind as "structure" | "provider" | null) ?? "structure")
        : null,
  };
}
