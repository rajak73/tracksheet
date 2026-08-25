/**
 * Chart primitives.
 *
 * Written rather than installed, for the reason given in icons.tsx: this
 * product needs three chart shapes, and a general-purpose charting library
 * would outweigh the entire rest of the dependency list (§38).
 *
 * The responsive technique is worth knowing, because it is what usually pushes
 * people to a library. The SVG shape layer uses `preserveAspectRatio="none"`
 * so it stretches to whatever width it is given, and every stroke carries
 * `vector-effect="non-scaling-stroke"` so line weight stays constant while the
 * geometry distorts. Text never goes inside the SVG — labels are HTML beside
 * or below it, so they keep their real size on a 390px screen.
 *
 * Every chart answers ONE question, named in its title by the caller (§20).
 * None of them compute anything: they take numbers the server calculated and
 * draw them. No aggregation, no derivation, no "helpful" totals.
 */

"use client";

import type { ReactNode } from "react";
import { Card, CardHeader, EmptyState } from "@/app/_components/ui";

/* ── Category colour ───────────────────────────────────────────────────── */

/**
 * Activity type code → colour. Fixed assignment, never by index, so adding a
 * category cannot recolour Teaching. Unknown codes fall back to "other"
 * rather than getting a generated colour, which keeps the palette closed.
 */
const CATEGORY_VAR: Record<string, string> = {
  // Listed in the order the palette was validated in — see globals.css.
  TEACHING: "--cat-teaching",
  PRACTICAL_LAB: "--cat-practical-lab",
  MENTORING: "--cat-mentoring",
  ASSESSMENT: "--cat-assessment",
  STUDENT_SUPPORT: "--cat-support",
  RESEARCH: "--cat-research",
  CONTENT_DEVELOPMENT: "--cat-content",
  MEETING: "--cat-meeting",
  TRAINING_WORKSHOP: "--cat-training",
  ADMINISTRATIVE: "--cat-admin",
  LEARNING: "--cat-learning",
  DELIVERABLE: "--cat-deliverable",
  OTHER: "--cat-other",
  DAILY_OPENING: "--cat-opening",
  DAILY_CLOSING: "--cat-closing",
  UNUTILIZED: "--cat-unutilized",
};

export function categoryColor(code: string): string {
  return `var(${CATEGORY_VAR[code] ?? "--cat-other"})`;
}

/** Codes arrive as SCREAMING_SNAKE; nothing else in the UI should re-do this. */
export function categoryLabel(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ── Shared chrome ─────────────────────────────────────────────────────── */

/**
 * A chart in a card.
 *
 * `question` is the title, and it is meant to be a question or a claim —
 * "Teaching hours against weekly target", not "Activity overview" (§20). The
 * prop is named for the rule so the rule is hard to forget at the call site.
 */
export function ChartCard({
  question,
  description,
  actions,
  children,
  isEmpty,
  emptyTitle = "Not enough data to chart",
  emptyDescription,
}: {
  question: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <Card>
      <CardHeader title={question} description={description} actions={actions} />
      {isEmpty ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <div className="p-5">{children}</div>
      )}
    </Card>
  );
}

export function ChartLegend({
  items,
}: {
  items: Array<{ label: string; color: string; value?: string; hatched?: boolean }>;
}) {
  return (
    <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden
            className={`size-2.5 shrink-0 rounded-chip ${item.hatched ? "hatched" : ""}`}
            style={item.hatched ? undefined : { background: item.color }}
          />
          <span className="text-muted">{item.label}</span>
          {item.value ? (
            <span className="tabular font-medium text-content">{item.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* ── Trend ─────────────────────────────────────────────────────────────── */

export type TrendPoint = { label: string; value: number | null };

/**
 * A single series over time, optionally against a target line.
 *
 * Null values are GAPS, not zeroes — a day with no records breaks the line
 * rather than dropping it to the axis. Drawing "no data" as zero is the exact
 * misreading this product is built to prevent, and it must not be reintroduced
 * by a chart.
 */
export function TrendLine({
  points,
  compare,
  seriesLabel,
  target,
  unit = "hrs",
  tone = "var(--app-primary)",
  height = 160,
}: {
  points: TrendPoint[];
  /**
   * An earlier period drawn behind the current one, for "is this better than
   * last time".
   *
   * Dashed and unfilled, deliberately: two solid filled areas on one axis read
   * as a stacked chart, and these do not stack — they are the same measurement
   * twice. It shares the scale, so the comparison is the shape rather than a
   * second axis nobody checks.
   *
   * It is aligned by INDEX, not by date, which is the only alignment that makes
   * sense across months of different lengths: the 3rd against the 3rd. A
   * shorter comparison simply stops early.
   */
  compare?: { label: string; points: TrendPoint[] };
  /** Names the main series once a comparison makes the distinction matter. */
  seriesLabel?: string;
  target?: number | null;
  unit?: string;
  tone?: string;
  height?: number;
}) {
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const compareValues = (compare?.points ?? [])
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  // One scale for both, or the comparison would be drawn to its own height and
  // a worse month could look identical to a better one.
  const max = Math.max(...values, ...compareValues, target ?? 0, 1);
  const n = points.length;

  // Coordinate space is 0..100 in both axes; the SVG then stretches to fit.
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;

  // Split into runs of consecutive non-null points so gaps stay gaps.
  const runs: Array<Array<{ i: number; v: number }>> = [];
  let run: Array<{ i: number; v: number }> = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v: p.value });
    }
  });
  if (run.length) runs.push(run);

  /* The comparison's runs, on the SAME x-scale as the main series so index i
     lands in the same column. */
  const compareRuns: Array<Array<{ i: number; v: number }>> = [];
  {
    let r: Array<{ i: number; v: number }> = [];
    (compare?.points ?? []).slice(0, n).forEach((p, i) => {
      if (p.value === null) {
        if (r.length) compareRuns.push(r);
        r = [];
      } else {
        r.push({ i, v: p.value });
      }
    });
    if (r.length) compareRuns.push(r);
  }

  const summary = points
    .map((p) => `${p.label}: ${p.value === null ? "no data" : `${p.value} ${unit}`}`)
    .join("; ");

  return (
    <div>
      {compare || seriesLabel ? (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-4 text-xs text-muted">
          {seriesLabel ? (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-0.5 w-5 rounded-full"
                style={{ background: tone }}
              />
              {seriesLabel}
            </span>
          ) : null}
          {compare ? (
            <span className="inline-flex items-center gap-1.5">
              {/* Drawn as a dash so the key matches the line it names. */}
              <span
                aria-hidden
                className="inline-block h-0.5 w-5 rounded-full"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(to right, var(--app-text-subtle) 0 5px, transparent 5px 9px)",
                }}
              />
              {compare.label}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="relative" style={{ height }}>
        <svg
          className="size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Trend. ${summary}${
            compare
              ? `. Compared with ${compare.label}: ${compare.points
                  .slice(0, n)
                  .map((p) => `${p.label}: ${p.value === null ? "no data" : `${p.value} ${unit}`}`)
                  .join("; ")}`
              : ""
          }${target != null ? `. Target ${target} ${unit}` : ""}`}
        >
          {[0, 50, 100].map((g) => (
            <line
              key={g}
              x1="0"
              x2="100"
              y1={g}
              y2={g}
              stroke="var(--app-border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {target != null && target > 0 ? (
            <line
              x1="0"
              x2="100"
              y1={y(target)}
              y2={y(target)}
              stroke="var(--app-text-subtle)"
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}

          {/* Behind the current series, so the line being read is on top. */}
          {compareRuns.map((r, ri) =>
            r.length > 1 ? (
              <path
                key={`c${ri}`}
                d={`M ${r.map((p) => `${x(p.i)} ${y(p.v)}`).join(" L ")}`}
                fill="none"
                stroke="var(--app-text-subtle)"
                strokeWidth="2"
                strokeDasharray="5 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null,
          )}

          {runs.map((r, ri) => (
            <g key={ri}>
              {r.length > 1 ? (
                <path
                  d={`M ${r.map((p) => `${x(p.i)} ${y(p.v)}`).join(" L ")} L ${x(
                    r[r.length - 1].i,
                  )} 100 L ${x(r[0].i)} 100 Z`}
                  fill={tone}
                  opacity="0.08"
                />
              ) : null}
              <path
                d={`M ${r.map((p) => `${x(p.i)} ${y(p.v)}`).join(" L ")}`}
                fill="none"
                stroke={tone}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </svg>

        {/* Hover targets live in HTML, not SVG, so the tooltip is a real title
            attribute rather than a hand-built overlay. */}
        <div className="absolute inset-0 flex">
          {points.map((p) => (
            <div
              key={p.label}
              className="flex-1 hover:bg-hovered/40"
              title={`${p.label} — ${p.value === null ? "no data recorded" : `${p.value} ${unit}`}`}
            />
          ))}
        </div>
      </div>

      <div className="mt-2 flex justify-between text-xs text-subtle">
        <span>{points[0]?.label}</span>
        {points.length > 2 ? <span>{points[Math.floor(points.length / 2)]?.label}</span> : null}
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/* ── Comparison bars ───────────────────────────────────────────────────── */

export type CompareBar = {
  label: string;
  /** Recorded work. */
  value: number;
  /** What was available. Drawn as the ghost track behind `value`. */
  capacity?: number;
  /** True when the day had no records at all — drawn hatched, never as zero. */
  noData?: boolean;
  tone?: string;
};

/**
 * Recorded hours against available capacity, one bar per period.
 *
 * The capacity track is drawn behind rather than beside, so the question
 * "how much of the day was used?" is answered by proportion at a glance
 * instead of by comparing two bar heights.
 */
export function BarCompare({
  bars,
  unit = "hrs",
  height = 160,
}: {
  bars: CompareBar[];
  unit?: string;
  height?: number;
}) {
  const max = Math.max(...bars.map((b) => Math.max(b.value, b.capacity ?? 0)), 1);

  const summary = bars
    .map((b) =>
      b.noData
        ? `${b.label}: no data`
        : `${b.label}: ${b.value} of ${b.capacity ?? max} ${unit}`,
    )
    .join("; ");

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height }} role="img" aria-label={summary}>
        {bars.map((b) => {
          const capPct = ((b.capacity ?? max) / max) * 100;
          const valPct = (b.value / max) * 100;
          return (
            <div
              key={b.label}
              className="relative flex-1"
              style={{ height: "100%" }}
              title={
                b.noData
                  ? `${b.label} — no activity recorded`
                  : `${b.label} — ${b.value} of ${b.capacity ?? max} ${unit}`
              }
            >
              <div
                className={`absolute bottom-0 w-full rounded-chip ${b.noData ? "hatched" : "bg-sunken"}`}
                style={{ height: `${Math.max(capPct, 2)}%` }}
              />
              {!b.noData ? (
                <div
                  className="absolute bottom-0 w-full rounded-chip"
                  style={{
                    height: `${Math.max(valPct, b.value > 0 ? 2 : 0)}%`,
                    background: b.tone ?? "var(--app-primary)",
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex gap-1">
        {bars.map((b) => (
          <div key={b.label} className="min-w-0 flex-1 truncate text-center text-xs text-subtle">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Allocation ────────────────────────────────────────────────────────── */

export type AllocationSlice = { code: string; hours: number };

/**
 * How capacity was allocated: a single 100% stacked bar plus a legend.
 *
 * A stacked bar rather than a pie, because the useful comparison is between
 * this period and the next one, and pie slices cannot be compared across two
 * charts. `unutilizedHours` is passed separately and drawn hatched — it is the
 * absence of work, not a kind of work.
 */
export function AllocationBar({
  slices,
  unutilizedHours = 0,
  missingDataHours = 0,
}: {
  slices: AllocationSlice[];
  unutilizedHours?: number;
  missingDataHours?: number;
}) {
  const present = slices.filter((s) => s.hours > 0).sort((a, b) => b.hours - a.hours);
  const total =
    present.reduce((sum, s) => sum + s.hours, 0) + unutilizedHours + missingDataHours;

  if (total <= 0) return null;

  const pct = (h: number) => (h / total) * 100;

  const segments = [
    ...present.map((s) => ({
      key: s.code,
      label: categoryLabel(s.code),
      hours: s.hours,
      color: categoryColor(s.code),
      hatched: false,
    })),
    ...(unutilizedHours > 0
      ? [
          {
            key: "__unutilized",
            label: "Unutilized capacity",
            hours: unutilizedHours,
            color: "var(--cat-unutilized)",
            hatched: true,
          },
        ]
      : []),
    ...(missingDataHours > 0
      ? [
          {
            key: "__missing",
            label: "No records",
            hours: missingDataHours,
            color: "var(--app-warning)",
            hatched: false,
          },
        ]
      : []),
  ];

  return (
    <div>
      <div
        className="flex h-8 w-full overflow-hidden rounded-chip"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${s.hours} hours, ${Math.round(pct(s.hours))} percent`)
          .join("; ")}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className={s.hatched ? "hatched" : ""}
            style={{
              width: `${pct(s.hours)}%`,
              background: s.hatched ? undefined : s.color,
            }}
            title={`${s.label} — ${s.hours} hrs (${Math.round(pct(s.hours))}%)`}
          />
        ))}
      </div>

      <ChartLegend
        items={segments.map((s) => ({
          label: s.label,
          color: s.color,
          hatched: s.hatched,
          value: `${s.hours}h`,
        }))}
      />
    </div>
  );
}

/* ── Sparkline ─────────────────────────────────────────────────────────── */

/** A trend small enough to sit inside a table row or a KPI card. */
export function Sparkline({
  values,
  tone = "var(--app-primary)",
  width = 64,
  height = 20,
}: {
  values: Array<number | null>;
  tone?: string;
  width?: number;
  height?: number;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return <span className="text-xs text-subtle">—</span>;

  const max = Math.max(...present, 1);
  const step = 100 / (values.length - 1);
  const path = values
    .map((v, i) => (v === null ? null : `${i * step} ${100 - (v / max) * 100}`))
    .filter(Boolean)
    .join(" L ");

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend across ${values.length} periods`}
      className="shrink-0"
    >
      <path
        d={`M ${path}`}
        fill="none"
        stroke={tone}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
