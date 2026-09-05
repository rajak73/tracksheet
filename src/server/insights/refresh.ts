/**
 * Bringing a day's insight up to date, after the work changed.
 *
 * ── Why this is not a page view's job ─────────────────────────────────────
 * It used to be. A day was normalised the first time somebody with generation
 * rights opened it — in practice, the instructor themselves. So a manager
 * looking at a roster saw PENDING for everybody who had not opened their own
 * worklog that week, and whether an insight existed depended on who had
 * browsed, not on what had been recorded.
 *
 * An insight is derived from a worklog, so its lifecycle follows the worklog.
 * This runs after a day is written, once, for the person whose day it is. A
 * page view then only ever reads.
 *
 * ── Why it is deliberately quiet ──────────────────────────────────────────
 * Saving a worklog must not fail because a model was slow or refusing. The
 * write has already been committed and answered by the time this runs, and
 * everything it could do wrong — a provider outage, a refused reply — is
 * already a state the readers handle. So it logs and returns; it never throws
 * into the request that scheduled it.
 */
import { prisma } from "@/server/db";
import {
  buildCanonicalContext,
  canonicalJson,
  contextHash,
  modelId,
  PROMPT_VERSION_EXTRACT,
} from "./context";
import { summariseDay, type DayRow } from "./serve-day";
import { toDateOnly } from "@/server/time/workday";

/**
 * Normalise one day, unless it is already current.
 *
 * Safe to call on every write: `summariseDay` compares the source hash first
 * and returns the stored row untouched when nothing that matters changed, so a
 * save that only moved a remark costs nothing.
 */
export async function refreshDayInsight(instructorId: string, date: string): Promise<void> {
  try {
    const context = await buildCanonicalContext({
      instructorId,
      periodStart: date,
      periodEnd: date,
    });
    const row = context.days[0] as DayRow | undefined;

    /* The day was emptied rather than edited. Its insight describes work that
       no longer exists, and an insight outliving its source is the one thing a
       derived row must never do. */
    if (!row) {
      await prisma.dayExtraction.deleteMany({
        where: { instructorId, logDate: toDateOnly(date) },
      });
      return;
    }

    const sourceHash = contextHash(canonicalJson(context), PROMPT_VERSION_EXTRACT, modelId());
    await summariseDay({ instructorId, logDate: toDateOnly(date), row, sourceHash });
  } catch (error) {
    /* Never rethrown. The write it followed is already committed and answered,
       and a day left un-normalised is a state every reader already renders. */
    console.info(
      `[insight] could not refresh ${instructorId} ${date} — ` +
        (error instanceof Error ? error.message : "unknown error"),
    );
  }
}
