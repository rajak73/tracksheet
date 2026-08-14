import Link from "next/link";

/**
 * A single AI insight, in the product's own structure.
 *
 * Two rules this component exists to enforce:
 *
 * 1. Severity is carried by the BADGE and a thin left rule — never by
 *    flooding the whole card in red. One component with severity variants,
 *    not five different card designs.
 * 2. An insight always shows the evidence it was derived from. The narration
 *    is generated; the numbers beside it are not. Presenting the sentence
 *    without the metric is how an intelligence layer starts reading as an
 *    oracle, which is exactly the impression to avoid.
 */

export type InsightSeverity = "high" | "medium" | "low";

const SEVERITY: Record<
  InsightSeverity,
  { label: string; badge: string; rule: string }
> = {
  high: {
    label: "High",
    badge: "bg-danger-subtle text-danger-text",
    rule: "bg-danger",
  },
  medium: {
    label: "Medium",
    badge: "bg-warning-subtle text-warning-text",
    rule: "bg-warning",
  },
  low: {
    label: "Low",
    badge: "bg-info-subtle text-info-text",
    rule: "bg-info",
  },
};

export function AIInsightCard({
  severity,
  title,
  summary,
  metrics,
  scope,
  href,
}: {
  severity: InsightSeverity;
  title: string;
  summary: string;
  /** The figures the narration was derived from. */
  metrics?: Array<{ label: string; value: string }>;
  /** Which university/period this was detected over. */
  scope?: string;
  href?: string;
}) {
  const tone = SEVERITY[severity];

  return (
    <article className="relative overflow-hidden rounded-card border border-line bg-surface p-5">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-0.5 ${tone.rule}`} />

      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          AI Insight
        </p>
        <span
          className={`shrink-0 rounded-pill px-2.5 py-0.5 text-xs font-medium ${tone.badge}`}
        >
          {tone.label}
        </span>
      </div>

      <h3 className="mt-3 text-base font-semibold text-content">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{summary}</p>

      {metrics && metrics.length > 0 ? (
        <dl className="mt-4 grid grid-cols-3 gap-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-control bg-sunken px-3 py-2">
              <dt className="truncate text-[11px] text-muted">{metric.label}</dt>
              <dd className="tabular mt-0.5 text-sm font-semibold text-content">{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <p className="text-xs text-subtle">
          {scope ? `Detected from recorded activity · ${scope}` : "Detected from recorded activity"}
        </p>
        {href ? (
          <Link
            href={href}
            className="rounded-control text-sm font-medium text-primary hover:underline"
          >
            View insight →
          </Link>
        ) : null}
      </div>
    </article>
  );
}
