"use client";

/**
 * The AI Insight cell: extracted points for a day, grouped activity for a week.
 *
 * ── What it renders, and what it never renders ────────────────────────────
 * A day's cell lists the points the extraction found in that day's own words:
 * the label with its topic, a count where the text stated one, a duration where
 * the text stated one. A week's cell lists what repeated, with the day entries
 * behind a disclosure — a summary that takes as much room as the text it
 * summarises has not summarised anything.
 *
 * Every duration goes through `formatMinutes`. A dash means the text stated no
 * duration; `00h 00m` means it stated none of it. Those are different facts and
 * a cell that prints `00h 00m` for the first is asserting something nobody
 * wrote.
 *
 * ── Generation is a permission, not a loading strategy ────────────────────
 * The cell asks for an insight on mount only when `canGenerate` — and the
 * server checks the same thing again from the session, because a prop is a
 * claim the client makes about itself. A manager's grid passes false and the
 * server would refuse anyway.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "@/app/_lib/api";
import { formatMinutes } from "@/app/_lib/format";
import { enqueueInsightFetch } from "@/app/_lib/insight-queue";

export type DayPoint = {
  label: string;
  /** The text's own noun for the count. Null renders the number alone. */
  sessions_unit?: string | null;
  /** Quoted from the text. Kept at day level, where the detail is the point. */
  subtopic: string | null;
  /** Inferred. Null when the activity names no subject matter. */
  topic: string | null;
  sessions: number | null;
  minutes: number | null;
};

export type SubtopicRollup = {
  name: string;
  sessions: number | null;
  sessions_unit?: string | null;
  item_count: number;
};

export type GroupRollup = {
  name: string;
  item_count: number;
  sessions: number | null;
  sessions_unit?: string | null;
  minutes: number | null;
  day_count: number;
  subtopics?: SubtopicRollup[];
  entries?: string[];
};

/**
 * A count with the text's own noun: `2 classes`, `3 students`, or a bare `25`.
 *
 * The noun is quoted, never chosen: "3" beside "mentored final year students"
 * is not the same fact as "3 students", and picking a word for it would be
 * writing something the instructor did not.
 */
function Count({ n, unit }: { n: number | null; unit?: string | null }) {
  if (n === null) return null;
  const word = unit?.trim();
  return <span className="mr-2">{word ? `${n} ${word}` : n}</span>;
}

/**
 * Two identical activities are one point with a count of two.
 *
 * Done here rather than by the model, because the count comes from the activity
 * REPEATING and a model reporting `2` for a text that says `1, 1` would have
 * that 2 nulled by digit provenance — correctly, since the text never states
 * it. Counting occurrences is arithmetic, and arithmetic is code's job.
 */
function collapse(points: DayPoint[]): Array<DayPoint & { occurrences: number }> {
  const out: Array<DayPoint & { occurrences: number }> = [];
  for (const p of points) {
    const same = out.find(
      (o) => o.label === p.label && o.topic === p.topic && o.subtopic === p.subtopic,
    );
    if (!same) {
      out.push({ ...p, occurrences: 1 });
      continue;
    }
    same.occurrences += 1;
    // Stated counts add; a repeat with nothing stated is counted by occurrence.
    if (p.sessions !== null) same.sessions = (same.sessions ?? 0) + p.sessions;
    if (p.minutes !== null) same.minutes = (same.minutes ?? 0) + p.minutes;
  }
  return out;
}

export type DayInsightState =
  | { state: "READY"; summary: string; generatedAt: string }
  | { state: "PENDING" }
  | { state: "FAILED" };

export type ServedDay = {
  points: DayPoint[];
  unallocated_minutes: number;
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
  insight: { groups?: GroupRollup[]; unallocated_minutes?: number; days_logged?: number } | null;
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
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
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
      /* Grouped by topic, in first-seen order, with the untopiced ones after.
         An activity naming no subject matter — "Doubt clearing session",
         "Corrected" — is shown as itself. Forcing a topic onto it to avoid the
         cell echoing the Deliverable column would be worse than the echo: the
         echo is at least honest about having nothing to add. */
      const points = collapse(d.points);

      /* A heading earns its place only when two or more activities share the
         topic. One activity under a heading is a heading for one item, so it
         renders inline as `DSA — binary search` instead. */
      const counts = new Map<string, number>();
      for (const p of points) if (p.topic) counts.set(p.topic, (counts.get(p.topic) ?? 0) + 1);
      const headed = [...counts].filter(([, n]) => n >= 2).map(([t]) => t);

      const shown = (p: DayPoint & { occurrences: number }) =>
        p.sessions !== null ? p.sessions : p.occurrences > 1 ? p.occurrences : null;

      const row = (
        text: string,
        p: DayPoint & { occurrences: number },
        key: string,
        withDuration = true,
      ) => (
        <li key={key} className="flex items-baseline justify-between gap-2 text-sm">
          <span className="text-content">{text}</span>
          <span className="tabular shrink-0 text-xs text-muted">
            <Count n={shown(p)} unit={p.sessions_unit} />
            {withDuration ? formatMinutes(p.minutes) : null}
          </span>
        </li>
      );

      const dayTotal = d.points.some((p) => p.minutes !== null)
        ? d.points.reduce((n, p) => n + (p.minutes ?? 0), 0)
        : (d.total_minutes ?? null);

      return (
        <div className="min-w-[13rem] max-w-[22rem] space-y-2">
          {headed.map((topic) => (
            <div key={topic}>
              <div className="text-sm text-content">{topic}</div>
              {/* Under a heading the subtopic alone is the line — repeating the
                  topic on every row underneath says it three times. */}
              <ul className="space-y-1 pl-3">
                {points
                  .filter((p) => p.topic === topic)
                  .map((p, i) => row(p.subtopic ?? p.label, p, `${topic}-${i}`))}
              </ul>
            </div>
          ))}
          <ul className="space-y-1">
            {points
              .filter((p) => !p.topic || !headed.includes(p.topic))
              .map((p, i) =>
                row(p.topic ? `${p.topic} — ${p.subtopic ?? p.label}` : p.label, p, `flat-${i}`),
              )}
          </ul>
          {/* Always, on its own line. The one figure a reader checks against the
              Working Hours column beside it. */}
          <div className="tabular flex items-baseline justify-between border-t border-line-subtle pt-1 text-xs text-muted">
            <span>Total</span>
            <span>{formatMinutes(dayTotal)}</span>
          </div>
          {/* No badge, no colour, no retry when the numbers are simply absent.
              A legacy day whose counts sat in a separate box has nothing anybody
              can attribute and nothing anybody can retry — the dashes above are
              the honest answer, and dressing them as a failure would report a
              property of what was written as a fault of the system. */}
          {d.unallocated_minutes > 0 && d.points.some((p) => p.minutes !== null) ? (
            <span className="mt-1 block text-xs text-subtle">
              {formatMinutes(d.unallocated_minutes)} not attributed
            </span>
          ) : null}
        </div>
      );
    }
  }

  /* ── A week or a month ─────────────────────────────────────────────────── */
  if (loaded?.kind === "period" && loaded.data.status === "READY") {
    const groups = loaded.data.insight?.groups ?? [];
    const unallocated = loaded.data.insight?.unallocated_minutes ?? 0;
    return (
      <div className="min-w-[13rem] max-w-[24rem]">
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.name}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-content">{g.name}</span>
                <span className="tabular shrink-0 text-xs text-muted">
                  <Count n={g.sessions} unit={g.sessions_unit} />
                  {formatMinutes(g.minutes)}
                  <span className="ml-2">
                    {g.day_count} {g.day_count === 1 ? "day" : "days"}
                  </span>
                </span>
              </div>
              {/* What the topic covered. Sessions only — a duration is stated per
                  activity, and repeating it here would print the same minutes
                  twice and invite somebody to add the second set. */}
              {g.subtopics?.length ? (
                <ul className="pl-3">
                  {g.subtopics.map((sub) => (
                    <li key={sub.name} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted">{sub.name}</span>
                      <span className="tabular shrink-0 text-subtle">
                        <Count n={sub.sessions} unit={sub.sessions_unit} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {/* `Other` says what it holds. "Two entries" tells a reader
                  nothing; a named topic is already described by its subtopics. */}
              {g.entries?.length ? (
                <ul className="pl-3">
                  {g.entries.map((e, i) => (
                    <li key={i} className="text-xs text-subtle">
                      · {e}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        {unallocated > 0 ? (
          <span className="mt-1 block text-xs text-subtle">
            {formatMinutes(unallocated)} not attributed
          </span>
        ) : null}
        {/* Collapsed. The rollup is the answer; the days are the working, and
            the working should not take more room than the answer. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-1 text-xs text-primary-text underline underline-offset-2 hover:no-underline"
        >
          {open ? "Hide the days" : `Show the ${loaded.data.insight?.days_logged ?? 0} days`}
        </button>
        {open ? (
          <ul className="mt-1 space-y-0.5 border-l border-line-subtle pl-2">
            {groups.map((g) => (
              <li key={g.name} className="text-xs text-subtle">
                {g.name} — {g.item_count} on {g.day_count} {g.day_count === 1 ? "day" : "days"}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
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
