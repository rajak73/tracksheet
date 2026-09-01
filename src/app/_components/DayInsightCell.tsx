"use client";

import { useState } from "react";
import { apiGet } from "@/app/_lib/api";

/**
 * The AI Insight column, for the tables that read `WorklogEntry`.
 *
 * ── Why this is not `AiInsightCell` ───────────────────────────────────────
 * That cell renders the old shape: a severity badge, a title, a
 * recommendation, and a list of named deliverables with minutes against each.
 * Every one of those came from the taxonomy — the model was asked which of the
 * client's named deliverables a line fell under, and the badge graded the
 * result. There is no taxonomy now, so there is nothing to name and nothing to
 * grade. What is stored for a period is one sentence.
 *
 * The two cells exist side by side on purpose. The pages that still read the
 * old tables still render the old cell, unchanged, until their own commits
 * move them. A single cell serving both would have to accept both shapes and
 * would end up asserting neither.
 *
 * ── The column never generates by rendering ───────────────────────────────
 * A page of rows arrives with the STORED state of each: READY with its
 * sentence, or PENDING, or FAILED. Nothing is asked of the model to paint the
 * table — a person paging back through a month would otherwise buy a month of
 * insights by scrolling.
 *
 * Generation happens when somebody presses the button in a cell, for that one
 * period. That is the whole cost model: a period nobody opens is never paid
 * for, and the person who pays is the person who asked.
 *
 * ── A week is not its days ────────────────────────────────────────────────
 * A week row shows no day's sentence. The stored day readings describe single
 * days, and printing one of them against a row covering seven would be a
 * summary of Tuesday presented as a summary of the week. A week row is PENDING
 * until a WEEK-scoped reading is asked for, which is what its button asks for.
 */

export type DayInsightState =
  | { state: "READY"; summary: string; generatedAt: string }
  | { state: "PENDING" }
  | { state: "FAILED" };

/** What the insight endpoint answers with. Only two fields are read here. */
type ServedInsight = {
  insight: { summary: string } | null;
  generated_at: string | null;
  status: "READY" | "PENDING" | "GENERATING" | "FAILED" | "EMPTY";
};

export function DayInsightCell({
  instructorId,
  scope,
  from,
  to,
  initial,
  canGenerate = true,
}: {
  instructorId: string | null;
  scope: "DAY" | "WEEK" | "MONTH";
  from: string;
  to: string;
  /** The stored state that came down with the row. */
  initial: DayInsightState | null;
  canGenerate?: boolean;
}) {
  /* `initial` is the server's answer and the prop is the source of truth until
     this cell asks for its own. After that, what it was told wins — refetching
     the table would otherwise put PENDING back over a sentence just read. */
  const [own, setOwn] = useState<DayInsightState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const current = own ?? initial;

  async function analyse() {
    if (!instructorId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiGet<ServedInsight>(
        `/api/instructors/${instructorId}/insight?scope=${scope}&from=${from}&to=${to}`,
        "Could not read this period.",
      );
      const summary = res.insight?.summary ?? "";
      if (res.status === "FAILED") setOwn({ state: "FAILED" });
      else if (summary)
        setOwn({ state: "READY", summary, generatedAt: res.generated_at ?? new Date().toISOString() });
      /* EMPTY — nothing recorded in the period — and PENDING both leave the
         cell where it was rather than inventing a state for it. */ else setOwn({ state: "PENDING" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read this period.");
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return <span className="text-sm text-subtle">Reading…</span>;
  }

  if (current?.state === "READY") {
    return (
      <div className="min-w-[13rem] max-w-[22rem]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full text-left"
          title={`Read ${new Date(current.generatedAt).toLocaleString()}`}
        >
          <span
            className={
              open ? "text-sm leading-snug text-muted" : "line-clamp-2 text-sm leading-snug text-muted"
            }
          >
            {current.summary}
          </span>
        </button>
      </div>
    );
  }

  const failed = current?.state === "FAILED";

  return (
    <div className="min-w-[10rem] space-y-1">
      <span className={failed ? "block text-sm text-danger-text" : "block text-sm text-subtle"}>
        {failed ? "Could not be read" : "Not analysed yet"}
      </span>
      {canGenerate && instructorId ? (
        <button
          type="button"
          onClick={() => void analyse()}
          className="text-xs text-primary-text underline underline-offset-2 hover:no-underline"
        >
          {failed ? "Try again" : "Analyse"}
        </button>
      ) : null}
      {/* The failure is shown where it happened rather than as a toast: the
          cell that could not be read is the thing being reported on. */}
      {error ? <span className="block text-xs text-danger-text">{error}</span> : null}
    </div>
  );
}
