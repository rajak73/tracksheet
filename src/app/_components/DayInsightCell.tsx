"use client";

/**
 * The AI Insight cell: one paragraph for a day, one for a week or a month.
 *
 * ── What it renders, and what it never renders ────────────────────────────
 * The paragraph the summariser wrote, and nothing beside it. No total: the
 * Working Hours column already shows one, and the summariser is instructed not
 * to repeat it, because a figure printed twice invites a reader to check one
 * against the other. No warnings either — those are internal, and a column
 * showing the model second-guessing itself is not something a manager can act
 * on.
 *
 * ── Generation is a permission, not a loading strategy ────────────────────
 * The cell asks for an insight on mount only when `canGenerate` — and the
 * server checks the same thing again from the session, because a prop is a
 * claim the client makes about itself. A manager's grid passes false and the
 * server would refuse anyway.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/app/_lib/api";
import { enqueueInsightFetch } from "@/app/_lib/insight-queue";

/** One activity line, as the summariser returns it. */
export type InsightItem = { activity: string; durationMinutes: number };

/**
 * `1 hr`, `45 min`, `1 hr 30 min` — the compact form the column asks for.
 *
 * Zero returns an empty string: it means the activity shares one reported total
 * with others and has no figure of its own, so the phrase renders alone rather
 * than beside a `0 min` nobody wrote.
 */
function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** The list itself, shared by the day cell and the period cell. */
function InsightList({ items }: { items: InsightItem[] }) {
  return (
    <ul className="min-w-[13rem] max-w-[24rem] space-y-0.5">
      {items.map((item, i) => {
        const duration = formatDuration(item.durationMinutes);
        return (
          <li key={`${item.activity}-${i}`} className="flex gap-1.5 text-sm leading-snug text-content">
            <span aria-hidden className="select-none text-subtle">•</span>
            <span>
              {item.activity}
              {duration ? <span className="text-muted"> - {duration}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export type DayInsightState =
  | { state: "READY"; summary: string; generatedAt: string }
  | { state: "PENDING" }
  | { state: "FAILED" };

export type ServedDay = {
  /** The day's activities, one line each. */
  items?: InsightItem[];
  /** The day's recorded total, so the Total line can show it when no activity
   *  stated a duration — which is the common case on clock-range days. */
  total_minutes?: number;
  raw_text: string | null;
  generated_at: string | null;
  status: "READY" | "PENDING" | "FAILED" | "EMPTY";
  last_error: string | null;
  failure_kind?: "structure" | "provider" | null;
};

export type ServedPeriod = {
  insight: {
    /** The period's activities, consolidated across its days. */
    items?: InsightItem[];
    days_logged?: number;
    total_minutes?: number;
  } | null;
  generated_at: string | null;
  status: "READY" | "PENDING" | "GENERATING" | "FAILED" | "EMPTY";
};

type Loaded =
  | { kind: "day"; data: ServedDay }
  | { kind: "period"; data: ServedPeriod }
  | { kind: "error"; message: string };

export function DayInsightCell({
  instructorId,
  scope,
  from,
  to,
  initial,
  canGenerate = true,
  /** Off in tests and anywhere a view must cost nothing to open. */
  autoGenerate = true,
  served = null,
}: {
  instructorId: string | null;
  scope: "DAY" | "WEEK" | "MONTH";
  from: string;
  to: string;
  initial: DayInsightState | null;
  canGenerate?: boolean;
  autoGenerate?: boolean;
  /**
   * What the server already knows, handed down with the row.
   *
   * The table's own query has read these days; making the cell fetch them again
   * on mount would spend a round trip to learn what arrived with the page, and
   * would show Pending for a moment on a day that is not pending.
   */
  served?: ServedDay | ServedPeriod | null;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(
    served ? (scope === "DAY"
      ? { kind: "day", data: served as ServedDay }
      : { kind: "period", data: served as ServedPeriod }) : null,
  );

  /* ── `served` may arrive AFTER the first render ──────────────────────────
   *
   * The state above is seeded from the prop, and a `useState` initialiser runs
   * once. The roster renders as soon as its worklog query resolves and the bulk
   * insight query lands a moment later, so on a manager's sheet the first
   * render almost always had `served` null — and because a manager may not
   * generate, the effect below returns early and nothing ever replaced it. The
   * cell sat on "Pending" over a row the database had marked READY.
   *
   * That is why it was intermittent rather than broken: it worked only when the
   * insight query happened to win the race against the worklog query. */
  useEffect(() => {
    if (!served) return;
    setLoaded(
      scope === "DAY"
        ? { kind: "day", data: served as ServedDay }
        : { kind: "period", data: served as ServedPeriod },
    );
  }, [served, scope]);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);

  const url = `/api/instructors/${instructorId}/insight?scope=${scope}&from=${from}&to=${to}`;

  const load = useCallback(async () => {
    if (!instructorId) return;
    setBusy(true);
    try {
      if (scope === "DAY") {
        setLoaded({ kind: "day", data: await apiGet<ServedDay>(url, "Could not read this day.") });
      } else {
        setLoaded({
          kind: "period",
          data: await apiGet<ServedPeriod>(url, "Could not read this period."),
        });
      }
    } catch (e) {
      setLoaded({ kind: "error", message: e instanceof Error ? e.message : "Could not read this." });
    } finally {
      setBusy(false);
    }
  }, [instructorId, scope, url]);

  useEffect(() => {
    /* Once per cell, through the shared queue. Without the ref a re-render
       would re-queue a fetch that is already in flight. */
    /* Nothing to ask for when the server already answered, and nothing to ask
       WITH when the viewer may not generate. */
    if (!autoGenerate || !canGenerate || !instructorId || asked.current) return;
    if (loaded && loaded.kind !== "error") return;
    asked.current = true;
    enqueueInsightFetch(load);
  }, [autoGenerate, canGenerate, instructorId, load, loaded]);

  if (busy && !loaded) return <span className="text-sm text-subtle">Reading…</span>;

  if (loaded?.kind === "error") {
    return <span className="block text-xs text-danger-text">{loaded.message}</span>;
  }

  /* ── A day ─────────────────────────────────────────────────────────────── */
  if (loaded?.kind === "day") {
    const d = loaded.data;

    if (d.status === "FAILED") {
      /* Two failures, told apart because they mean opposite things. The checks
         refusing what the model said is a property of the entry; never getting
         an answer is an outage. Neither is the third case below — a day that
         extracted cleanly and simply has no numbers to show. */
      const structural = (d.failure_kind ?? "structure") === "structure";
      return (
        <div className="min-w-[13rem] max-w-[22rem] space-y-1">
          {/* The record, unchanged. A day that could not be structured is still
              a day that was written, and the words are what it is. */}
          <p className="text-sm leading-snug text-content">{d.raw_text}</p>
          <span className="block text-xs text-subtle">
            {structural ? "Couldn’t structure this entry" : "Couldn’t reach the reader"}
          </span>
          {canGenerate ? (
            <button
              type="button"
              onClick={() => void load()}
              className="text-xs text-primary-text underline underline-offset-2 hover:no-underline"
            >
              Try again
            </button>
          ) : null}
        </div>
      );
    }

    if (d.status === "READY") {
      /* ── The activity list ────────────────────────────────────────────
       * One line per activity: what it was, and how long it took.
       *
       * No total underneath. The Working Hours column already shows the day's
       * total, and printing a figure twice invites a reader to check one
       * against the other. */
      if (d.items && d.items.length > 0) {
        return <InsightList items={d.items} />;
      }

      /* No paragraph, but the day is READY — the summariser answered without
         one, which the parser refuses, so this is only reachable for a row
         written before the current summariser. Show the instructor's own words
         rather than an empty cell. */
      return (
        <div className="min-w-[13rem] max-w-[24rem]">
          <p className="text-sm text-subtle">{d.raw_text ?? "—"}</p>
        </div>
      );
    }
  }

  /* ── A week or a month ─────────────────────────────────────────────────── */
  if (loaded?.kind === "period" && loaded.data.status === "READY") {
    /* The same list, consolidated across the period rather than concatenated
       from its days — see `period-rollup.ts`. */
    const periodItems = loaded.data.insight?.items;
    if (periodItems && periodItems.length > 0) {
      return <InsightList items={periodItems} />;
    }

    /* Same as the day: READY with nothing written is only reachable for a
       payload cached before the current summariser. */
    return <span className="block text-sm text-subtle">—</span>;
  }

  /* A day or period nobody filed. Not pending: there is nothing to summarise,
     and a cell promising an insight for it promises something never coming. */
  if (
    (loaded?.kind === "day" && loaded.data.status === "EMPTY") ||
    (loaded?.kind === "period" && loaded.data.status === "EMPTY")
  ) {
    return <span className="block text-sm text-subtle">—</span>;
  }

  const failed = initial?.state === "FAILED";
  return (
    <div className="min-w-[10rem] space-y-1">
      <span className={failed ? "block text-sm text-danger-text" : "block text-sm text-subtle"}>
        {failed ? "Could not be read" : "Pending"}
      </span>
      {canGenerate && instructorId ? (
        <button
          type="button"
          onClick={() => void load()}
          className="text-xs text-primary-text underline underline-offset-2 hover:no-underline"
        >
          {failed ? "Try again" : "Analyse"}
        </button>
      ) : null}
    </div>
  );
}
