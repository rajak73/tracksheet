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
import { parseStoredSummary } from "./day-summary";
import { toDateOnly } from "@/server/time/workday";

/** One extracted point, as a day cell renders it. */
export type DayPoint = {
  label: string;
  sessions: number | null;
  /** Whole minutes, or null when the text stated no duration. */
  minutes: number | null;
};

/** One line of the day's summary, with its minutes summed in code. */
export type SummaryLine = { text: string; minutes: number | null };

export type ServedDayInsight = {
  scope: { type: "DAY"; period_start: string; period_end: string };
  points: DayPoint[];
  /**
   * The day in words: what was done, and one line about what the day was.
   *
   * Every duration here is added up HERE, from the activities each bullet
   * names. The model wrote the words and not one figure in them.
   */
  summary: { lines: SummaryLine[]; insight: string } | null;
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
  summary: null,
  cached: false,
  generated_at: null,
  status: "EMPTY",
  last_error: null,
  failure_kind: null,
});

/**
 * A stored summary, with each bullet's minutes added from the points it names.
 *
 * This is where the arithmetic lives. The model returned prose and a list of
 * indexes; every figure the reader sees is computed from the record, which is
 * why a bullet can never claim a duration the activities do not support.
 */
function summaryWithMinutes(
  stored: unknown,
  points: DayPoint[],
  dayMinutes: number,
): { lines: SummaryLine[]; insight: string } | null {
  const summary = parseStoredSummary(stored);
  if (!summary) return null;
  return {
    insight: summary.insight,
    lines: summary.bullets.map((b) => {
      const mine = b.activities.map((i) => points[i]).filter((p): p is DayPoint => Boolean(p));
      const timed = mine.filter((p) => p.minutes !== null);
      if (timed.length > 0) {
        return { text: b.text, minutes: timed.reduce((n, p) => n + (p.minutes ?? 0), 0) };
      }
      /* Nothing under this bullet said how long it took. If the bullet covers
         the WHOLE day, the day's recorded total is how long it took — there is
         nothing else it could have been, and it is the same reasoning that lets
         a one-activity day's quantity box refer to that activity.
         
         Otherwise a dash: a six-hour day whose only line reads "—" looks like
         data went missing, and splitting the total across several bullets that
         never stated one would be inventing the split. */
      const coversDay = points.length > 0 && b.activities.length === points.length;
      return { text: b.text, minutes: coversDay && dayMinutes > 0 ? dayMinutes : null };
    }),
  };
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
      summary: summaryWithMinutes(stored.summary, stored.items as DayPoint[], day.workingMinutes),
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
      summary: null,
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
      summary: null,
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
    summary:
      fresh.status === "READY"
        ? summaryWithMinutes(fresh.summary, fresh.items as DayPoint[], day.workingMinutes)
        : null,
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
