"use client";

import { useState } from "react";
import { Badge } from "@/app/_components/ui";

/**
 * The AI Insight column.
 *
 * ── What changed, and why this is a column ────────────────────────────────
 * Insights used to be the main event: a screen of their own, prose first,
 * with the recorded work somewhere behind it. That inverts what people
 * actually came for. A manager opens these pages to see what their instructors
 * recorded — the hours, the deliverables, the days that are blank. The
 * reading of that data is useful, but it is a note IN THE MARGIN of the data,
 * not a replacement for it.
 *
 * So the raw rows come first everywhere, and this sits at the end of each one,
 * after the actions. It is the last column deliberately: you reach it having
 * already seen the numbers it is talking about, which is the only order in
 * which a summary can be checked rather than merely believed.
 *
 * ── An em dash is an answer ───────────────────────────────────────────────
 * A row with no stored insight prints "—", and that is correct rather than a
 * gap. Analysis happens after a day is written, so a day recorded moments ago
 * genuinely has not been read yet. The alternative — generating on demand so
 * the column is never empty — would put the model back in front of somebody
 * waiting for a page, which is the exact cost this whole change removed.
 *
 * Nothing here is ever invented client-side. If the server did not store a
 * sentence, this shows no sentence.
 */

export type InsightSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** One named deliverable, as the reading placed it. */
export type AnalysedDeliverable = {
  name: string;
  durationMinutes: number;
  quantity: number | null;
  quantityLabel: string;
};

export type CellInsight = {
  severity: InsightSeverity;
  title: string;
  summary: string;
  recommendation: string;
  /**
   * The reading of the raw text, as lines.
   *
   * This is the column's real content. The Deliverable column carries what the
   * instructor TYPED; this is which of the client's named deliverables that
   * amounts to, and for how long. Optional — an insight stored before the
   * breakdown was captured has none, and the sentence stands in.
   */
  deliverables?: AnalysedDeliverable[];
};

/** `6h`, `45m`, `1h 15m` — the report's own duration shape. */
function compactMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Severity to the product's own status vocabulary.
 *
 * HIGH and CRITICAL share `danger` on purpose. The difference between them is
 * real in the data and worth storing, but a table scanned at a glance needs
 * two states — fine, and not fine — and a third red would only compete with
 * the second. The label carries the distinction for anybody who stops to read.
 */
const TONE: Record<InsightSeverity, "success" | "warning" | "danger"> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
  CRITICAL: "danger",
};

const LABEL: Record<InsightSeverity, string> = {
  LOW: "Normal",
  MEDIUM: "Watch",
  HIGH: "Concern",
  CRITICAL: "Critical",
};

export function AiInsightCell({ insight }: { insight?: CellInsight | null }) {
  const [open, setOpen] = useState(false);

  if (!insight) {
    return (
      <span className="text-subtle">
        —<span className="sr-only-text">Not analysed yet</span>
      </span>
    );
  }

  const deliverables = insight.deliverables ?? [];

  return (
    <div className="min-w-[13rem] max-w-[22rem]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
        title={insight.title}
      >
        <span className="mt-0.5 shrink-0">
          <Badge tone={TONE[insight.severity]}>{LABEL[insight.severity]}</Badge>
        </span>

        {/* ── The reading, as lines ──────────────────────────────────────
            One deliverable per line with its measured duration, mirroring the
            Deliverable column beside it so the raw sentence and what it was
            taken to mean line up row for row.

            Every figure here was summed from the source rows — the model is
            asked which NAME a line falls under and is never shown a number, so
            nothing in this column can state a duration the day does not have.

            An insight stored before the breakdown existed has no deliverables;
            its sentence stands in rather than the cell going blank. */}
        {deliverables.length > 0 ? (
          <span className="min-w-0 flex-1">
            <ul className={open ? "space-y-1" : "space-y-1 overflow-hidden"}>
              {(open ? deliverables : deliverables.slice(0, 3)).map((d, i) => (
                <li key={i} className="flex items-start gap-1.5 text-sm leading-snug">
                  <span
                    aria-hidden
                    className="mt-[0.45em] inline-block size-1.5 shrink-0 rounded-full bg-primary"
                  />
                  <span className="text-content">
                    {d.name}
                    <span className="text-muted"> — {compactMinutes(d.durationMinutes)}</span>
                    {d.quantity !== null && d.quantityLabel ? (
                      <span className="text-subtle">
                        {" "}
                        ({d.quantity} {d.quantityLabel})
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {!open && deliverables.length > 3 ? (
              <span className="mt-0.5 block text-xs text-subtle">
                +{deliverables.length - 3} more
              </span>
            ) : null}
          </span>
        ) : (
          <span
            className={
              open ? "text-sm leading-snug text-muted" : "line-clamp-2 text-sm leading-snug text-muted"
            }
          >
            {insight.summary}
          </span>
        )}
      </button>

      {open ? (
        <div className="mt-1.5 space-y-1 border-l-2 border-line pl-2">
          {/* The sentence, kept behind the expand rather than dropped: it is
              the other half of what was read, and a reader checking the
              breakdown may want the prose that came with it. */}
          {deliverables.length > 0 && insight.summary ? (
            <p className="text-xs leading-relaxed text-muted">{insight.summary}</p>
          ) : null}
          <p className="text-xs leading-relaxed text-subtle">{insight.recommendation}</p>
        </div>
      ) : null}
    </div>
  );
}
