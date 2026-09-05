/**
 * A week or a month, summarised from the days' structured readings.
 *
 * ── Not from the daily paragraphs ─────────────────────────────────────────
 * Summarising a summary throws away exactly what a period needs — the counts,
 * the units, the durations — and repeats whatever the first pass got wrong. So
 * each day stores `normalizedActivities` when it is summarised, and a period is
 * built from those: the totals become arithmetic, and the model is asked only
 * to group and to write.
 *
 * ── Where each number comes from ──────────────────────────────────────────
 * The model is sent the days' labels and nothing else — no minutes, no totals.
 * It answers with one phrase per label, giving the same wording to labels that
 * are the same work, and `mergeByPhrase` sums the minutes behind that judgement.
 * There is no figure in the reply for anything to be wrong about.
 */
import {
  buildCanonicalContext,
  canonicalJson,
  contextHash,
  modelId,
  PROMPT_VERSION_EXTRACT,
} from "./context";
import { aggregatePeriod } from "./aggregates";
import { summariseDay, toSummaryDay, canonicalDay, type DayRow } from "./serve-day";
import { readItems } from "./canonical";
import { toDateOnly } from "@/server/time/workday";
import type { InsightItem, ProviderCall, SummaryDayInput } from "./worklog-summary";

export type PeriodRollup = {
  /** The period's activities, one line each, consolidated across its days. */
  items: InsightItem[];
  total_minutes: number;
  days_logged: number;
};

/**
 * Ensure every day in the period has a current summary, paying only for the
 * ones missing or stale.
 *
 * This is what makes a week cost one extra call rather than six on the common
 * path: the days were already summarised when the instructor looked at them.
 */
export async function ensureDaySummaries(input: {
  instructorId: string;
  periodStart: string;
  periodEnd: string;
  call?: ProviderCall;
}) {
  const context = await buildCanonicalContext({
    instructorId: input.instructorId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });

  const out: Array<{ row: DayRow; day: SummaryDayInput; items: InsightItem[] }> = [];

  for (const raw of context.days) {
    const row = raw as DayRow;

    /* Hashed over the DAY alone, exactly as the day path hashes it, so a day
       already summarised for its own view is a day this does not pay for. A
       hash over the period would match nothing and re-summarise everything. */
    const single = await buildCanonicalContext({
      instructorId: input.instructorId,
      periodStart: row.log_date,
      periodEnd: row.log_date,
    });
    const sourceHash = contextHash(canonicalJson(single), PROMPT_VERSION_EXTRACT, modelId());

    const stored = await summariseDay({
      instructorId: input.instructorId,
      logDate: toDateOnly(row.log_date),
      row,
      sourceHash,
      call: input.call,
    });

    out.push({
      row,
      day: toSummaryDay(row),
      items: stored.status === "READY" ? readItems(stored.items) : [],
    });
  }

  return out;
}

/**
 * Summarise a period.
 *
 * `call` is injected so a test can count provider calls; the route passes
 * nothing and gets the real provider.
 */
export async function buildPeriodRollup(input: {
  instructorId: string;
  periodStart: string;
  periodEnd: string;
  scope?: "WEEK" | "MONTH";
  call?: ProviderCall;
}): Promise<{ ok: true; rollup: PeriodRollup } | { ok: false; reason: string }> {
  const days = await ensureDaySummaries(input);

  const totalMinutes = days.reduce((n, d) => n + (d.row.working_minutes ?? 0), 0);
  const dayItems = days.flatMap((d) => d.items);

  if (dayItems.length === 0) {
    return { ok: false, reason: "no day in this period produced an activity" };
  }

  /* ── Grouped in code, not by a model ────────────────────────────────────
   *
   * Each day item carries the action, subject and topics the model read when
   * that day was normalised. Consolidating them is a join on those fields, and
   * the minutes are a sum — both deterministic, both free.
   *
   * This used to be a model call per period. At twelve hundred instructors that
   * was a call per person per week and per month, for work whose answer code
   * can compute exactly. The semantic judgement still happens once, per
   * activity, on the day it was written. */
  const items = aggregatePeriod(dayItems, input.scope === "MONTH" ? "MONTH" : "WEEK");

  return {
    ok: true,
    rollup: {
      items,
      total_minutes: totalMinutes,
      days_logged: days.length,
    },
  };
}

/* `canonicalDay` is re-exported so the day and the period agree on what a day
   IS when they hash one. Two definitions would drift, and the symptom would be
   a week re-summarising days it had already paid for. */
export { canonicalDay };
