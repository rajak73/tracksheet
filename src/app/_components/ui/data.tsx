/**
 * Rendering a number somebody else calculated.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import { TONE_TEXT } from "@/app/_components/ui/status";

import type { ReactNode } from "react";
import type { Tone } from "@/app/_components/ui/status";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Data display ──────────────────────────────────────────────────────── */

/**
 * A single headline number (§19).
 *
 * `null` renders as "Not measurable", never as 0 — the distinction between "we
 * measured zero" and "there was nothing to measure" is load-bearing throughout
 * this product and has to survive all the way to the screen.
 *
 * `delta` and `status` are what make this a KPI rather than a number in a box:
 * a figure with no comparison and no verdict cannot change what anyone does.
 */
export function StatTile({
  label,
  value,
  suffix,
  tone = "neutral",
  delta,
  deltaTone,
  status,
  timeframe,
  hint,
  emphasis = false,
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
  tone?: Tone;
  delta?: string;
  deltaTone?: Tone;
  status?: string;
  timeframe?: string;
  hint?: string;
  emphasis?: boolean;
}) {
  // No coloured top accent on the tile. Visual QA showed it hurting rather
  // than helping: the emphasised tile is often a *status* tone, so
  // Utilization at 20% drew a red bar above an already-red number and became
  // the loudest thing on the page. Emphasis is carried by the figure's size
  // and tone alone — which is also what the reference design does.
  return (
    <div className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
      <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">{label}</p>

      <p
        className={cx(
          "tabular mt-2 font-semibold",
          emphasis ? "text-3xl" : "text-2xl",
          value === null ? "text-subtle" : TONE_TEXT[tone],
        )}
      >
        {value === null ? (
          <span className="text-base font-normal">Not measurable</span>
        ) : (
          <>
            {value}
            {suffix ? (
              <span className="ml-1 text-base font-normal text-muted">{suffix}</span>
            ) : null}
          </>
        )}
      </p>

      {delta ? (
        <p
          className={cx(
            "tabular mt-1.5 text-xs font-medium",
            deltaTone ? TONE_TEXT[deltaTone] : "text-muted",
          )}
        >
          {delta}
        </p>
      ) : null}

      {status || timeframe || hint ? (
        <div className="mt-auto pt-2">
          {status ? <p className="text-xs font-medium text-content">{status}</p> : null}
          {hint ? <p className="text-xs text-muted">{hint}</p> : null}
          {timeframe ? <p className="mt-0.5 text-xs text-subtle">{timeframe}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A percentage as a bar plus its value.
 *
 * `label` carries the textual status alongside the colour, so the bar is not
 * the only thing distinguishing healthy from concerning (§21).
 */
export function Meter({
  value,
  tone = "primary",
  label,
  target,
}: {
  value: number | null;
  tone?: Tone;
  label?: string;
  target?: number | null;
}) {
  const tones: Record<Tone, string> = {
    neutral: "bg-subtle",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    primary: "bg-primary",
  };

  if (value === null) {
    return <span className="text-sm text-subtle">Not measurable</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-sunken">
        <div
          className={cx("h-full rounded-full", tones[tone])}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
        {target != null && target > 0 && target <= 100 ? (
          <span
            aria-hidden
            className="absolute inset-y-0 w-px bg-content/40"
            style={{ left: `${target}%` }}
          />
        ) : null}
      </div>
      <span className="tabular text-sm text-content">{value}%</span>
      {label ? <span className="hidden text-xs text-muted lg:inline">{label}</span> : null}
    </div>
  );
}

/** Label/value pairs for a detail header — the facts that identify a record. */
export function DescriptionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-1 truncate text-sm text-content">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
