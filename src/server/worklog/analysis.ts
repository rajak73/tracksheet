import { prisma } from "@/server/db";
import { summariseDays } from "@/server/worklog/day-summary";
import { loadUniversityConfig } from "@/server/universities/config";
import { computeDayWindows } from "@/server/time/schedule-windows";
import { toDateOnly } from "@/server/time/workday";
import { DID_NOT_HAPPEN } from "@/domain/working-hours";

/**
 * The reading of a day, done AFTER the day is safely stored.
 *
 * ── Why this module exists ────────────────────────────────────────────────
 * Classification used to happen while an instructor waited. A save called the
 * model, and a measured save took thirty-four seconds — on the screen every
 * instructor uses every day, at the moment they are trying to leave. The model
 * was on the critical path of a write, which is the one place it should never
 * be: it is slow, it is remote, and it can fail, and none of those should be
 * able to stop somebody recording that they taught a class.
 *
 * So the two jobs are now separated. `recordQuickEntry` writes rows and does
 * nothing else. This runs afterwards, off the request, and answers the
 * different question — what does the day MEAN — into `AiInsight`, where the
 * tables read it as a column.
 *
 * ── What is and is not the model's to say ─────────────────────────────────
 * The severity is computed here, from minutes recorded against the minutes the
 * university's configuration says the day held. It is arithmetic, and it is
 * the part somebody might act on, so it is not delegated. The model supplies
 * the sentence only — and even that comes through `summariseDays`, which never
 * shows it a number and recomputes every figure from the source rows.
 *
 * That split matters for a product whose whole claim is that a figure on
 * screen is traceable. A model that cannot state a number cannot state a wrong
 * one.
 *
 * ── Failure is silence, never an error ────────────────────────────────────
 * Nothing here can throw into a caller. The work is already committed by the
 * time this runs, so a provider outage costs an insight and not a day's
 * record: the column shows an em dash, which honestly means "not analysed",
 * and the next submission tries again.
 */

/** The `AiInsight.type` this module owns. One row per instructor per day. */
export const DAY_INSIGHT_TYPE = "WORKLOG_DAY";

export type DayAnalysisInput = {
  instructorId: string;
  universityId: string;
  /** YYYY-MM-DD in the university's zone. */
  workDate: string;
};

/**
 * Starts the analysis and returns immediately.
 *
 * Deliberately not awaited by its callers, and deliberately not returning the
 * promise either — an accidental `await` upstream would put the model back on
 * the write path, which is the exact thing this exists to prevent. The `void`
 * return makes that a type error rather than a regression nobody notices until
 * somebody times a save again.
 */
export function analyseDayInBackground(input: DayAnalysisInput): void {
  void analyseDay(input).catch(() => {
    /* Unreachable — `analyseDay` swallows its own failures. Here so that a
       future edit which lets one escape cannot become an unhandled rejection
       that takes the process down. */
  });
}

/**
 * Reads one recorded day and stores what it found.
 *
 * Exported for the tests, which need to await it. Production callers should
 * use {@link analyseDayInBackground}.
 */
export async function analyseDay(input: DayAnalysisInput): Promise<void> {
  try {
    const { instructorId, universityId, workDate } = input;

    const activities = await prisma.activityLog.findMany({
      where: { instructorId, workDate: toDateOnly(workDate) },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        status: true,
        activityType: { select: { code: true } },
      },
    });

    /* A day with nothing on it has nothing to say. It is also not silently
       left alone: whatever was there before is cleared, so a day emptied by a
       correction does not keep yesterday's verdict. */
    const counted = activities.filter(
      (a) => !a.status || !(DID_NOT_HAPPEN as readonly string[]).includes(a.status),
    );
    if (counted.length === 0) {
      await clearDayInsight(instructorId, workDate);
      return;
    }

    /* ── The numbers, computed here ──────────────────────────────────────
     * Capacity is what the university's configuration says the day held. A
     * non-working day has none, which is not zero utilisation — it is a day
     * that was never expected to hold work, and the severity below treats the
     * two differently. */
    const config = await loadUniversityConfig(universityId);
    const windows = computeDayWindows(config, workDate);
    const capacityMinutes = windows.workingHours?.durationMinutes ?? 0;

    const recordedMinutes = counted.reduce(
      (n, a) => n + Math.max(0, (a.endTime.getTime() - a.startTime.getTime()) / 60_000),
      0,
    );
    const unclassified = counted.filter((a) => a.activityType.code === "OTHER").length;
    const utilisation = capacityMinutes > 0 ? recordedMinutes / capacityMinutes : null;

    const severity = severityFor({ utilisation, unclassified, isWorkingDay: windows.isWorkingDay });

    /* ── The sentence ────────────────────────────────────────────────────
     * `summariseDays` owns every dealing with the provider: it caches on a
     * fingerprint of the day, falls back to deterministic prose when the model
     * is unreachable, and recomputes all arithmetic from the source rows. If
     * it returns nothing, the deterministic sentence below stands in — an
     * insight is still worth storing, because the severity is the actionable
     * half and it did not need a model at all. */
    let remark = "";
    let source: "ai" | "fallback" = "fallback";
    let deliverables: AnalysedDeliverable[] = [];
    try {
      const summaries = await summariseDays(instructorId, workDate, workDate);
      const day = summaries.get(workDate);
      if (day) {
        remark = day.remark;
        source = day.source;
        /* ── The deliverable reading ──────────────────────────────────────
         * This is the half the column actually shows. The instructor wrote a
         * sentence — "investigate intermittent OAuth token expiry" — and the
         * table now prints that sentence in the Deliverable column, because it
         * is what they recorded. Which of the client's named deliverables it
         * amounts to, and for how long, is an INTERPRETATION of that sentence,
         * and interpretations belong in the AI column.
         *
         * Every duration and count here is summed by `summariseDays` from the
         * source rows. The model is only asked which name each line falls
         * under; it is never shown a number and never states one. */
        deliverables = day.deliverables.map((d) => ({
          name: d.name,
          durationMinutes: d.durationMinutes,
          quantity: d.quantity,
          quantityLabel: d.quantityLabel,
        }));
      }
    } catch {
      // Provider or cache trouble. The deterministic sentence covers it.
    }

    const summary =
      describeDeliverables(deliverables) ||
      remark ||
      deterministicSummary(recordedMinutes, counted.length, unclassified);

    const supportingData = {
      recordedMinutes: Math.round(recordedMinutes),
      capacityMinutes,
      utilisation: utilisation === null ? null : Math.round(utilisation * 100) / 100,
      entryCount: counted.length,
      unclassifiedCount: unclassified,
      isWorkingDay: windows.isWorkingDay,
      /* Which half of this the model wrote. A reader comparing two insights
         should be able to tell a generated sentence from a computed one. */
      summarySource: source,
      /* The structured reading, kept beside the sentence so a screen can lay
         the deliverables out as lines rather than re-parsing prose. */
      deliverables,
      /* The one-sentence remark, still stored even when the deliverable
         breakdown is what gets shown — it is the other half of what was read
         and throwing it away would make the insight unreproducible. */
      remark,
    };

    /* Replace rather than accumulate. A day is submitted, corrected, and
       submitted again; without this the table would show the verdict on a
       version of the day that no longer exists, and the newest row is not
       reliably the truest one — it is only the newest. */
    await prisma.$transaction([
      prisma.aiInsight.deleteMany({
        where: { instructorId, type: DAY_INSIGHT_TYPE, periodStart: toDateOnly(workDate) },
      }),
      prisma.aiInsight.create({
        data: {
          scope: "INSTRUCTOR",
          universityId,
          instructorId,
          type: DAY_INSIGHT_TYPE,
          severity,
          title: titleFor(severity),
          summary,
          // The column the schema still requires; the actionable half here is
          // the severity, so this stays short rather than inventing advice.
          recommendation: recommendationFor(severity, unclassified),
          period: workDate,
          periodStart: toDateOnly(workDate),
          periodEnd: toDateOnly(workDate),
          sourceMetrics: supportingData,
          supportingData,
        },
      }),
    ]);
  } catch {
    /* Swallowed on purpose — see the module note. The row is already written;
       an insight is the only thing lost, and the next submission retries. */
  }
}

/** Removes the stored verdict for a day that no longer has anything on it. */
async function clearDayInsight(instructorId: string, workDate: string): Promise<void> {
  await prisma.aiInsight.deleteMany({
    where: { instructorId, type: DAY_INSIGHT_TYPE, periodStart: toDateOnly(workDate) },
  });
}

/**
 * How much attention the day deserves, from the numbers alone.
 *
 * Thresholds rather than a model, because this is the half somebody acts on.
 * A manager filtering for CRITICAL is entitled to know exactly what put a row
 * there, and "the model thought so" is not an answer they can check.
 */
function severityFor(input: {
  utilisation: number | null;
  unclassified: number;
  isWorkingDay: boolean;
}): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  /* Work on a non-working day is not a shortfall — there was no expectation to
     fall short of. It is worth noticing, which is why it is not LOW. */
  if (!input.isWorkingDay) return "MEDIUM";
  if (input.utilisation === null) return "LOW";

  if (input.utilisation < 0.25) return "CRITICAL";
  if (input.utilisation < 0.5) return "HIGH";
  if (input.utilisation < 0.8) return "MEDIUM";
  // A full day whose lines nobody could place still needs somebody to look.
  if (input.unclassified > 0) return "MEDIUM";
  return "LOW";
}

function titleFor(severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): string {
  if (severity === "CRITICAL") return "Very little recorded";
  if (severity === "HIGH") return "Well below the day's hours";
  if (severity === "MEDIUM") return "Worth a look";
  return "Day looks normal";
}

function recommendationFor(
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  unclassified: number,
): string {
  if (unclassified > 0) {
    return `${unclassified} ${unclassified === 1 ? "entry" : "entries"} could not be matched to a deliverable and recorded as Other. Setting the category makes this day count correctly in reports.`;
  }
  if (severity === "CRITICAL" || severity === "HIGH") {
    return "Check whether hours are missing from this day before it is reported on.";
  }
  return "No action needed.";
}

/** One named deliverable, as the reading placed it. */
type AnalysedDeliverable = {
  name: string;
  durationMinutes: number;
  quantity: number | null;
  quantityLabel: string;
};

/**
 * The deliverable breakdown as one line: what the raw text was taken to mean.
 *
 * `"Live Class - 6h · Doubt Clearing - 45m"`. Empty string when there is
 * nothing to say, so the caller can fall through to the next candidate rather
 * than storing a summary that says only punctuation.
 */
function describeDeliverables(deliverables: AnalysedDeliverable[]): string {
  if (deliverables.length === 0) return "";
  return deliverables
    .map((d) => `${d.name} - ${compactMinutes(d.durationMinutes)}`)
    .join(" · ");
}

/** `6h`, `45m`, `1h 15m` — the report's own duration shape. */
function compactMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** The sentence used when the model said nothing. Plain, and always true. */
function deterministicSummary(minutes: number, entries: number, unclassified: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  const parts = [
    `${entries} ${entries === 1 ? "entry" : "entries"} totalling ${hours}h`,
  ];
  if (unclassified > 0) {
    parts.push(`${unclassified} recorded as Other`);
  }
  return `${parts.join(", ")}.`;
}
