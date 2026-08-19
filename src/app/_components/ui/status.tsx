/**
 * Tone: which colour a value wears, decided once.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Status ────────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  success: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
  info: "bg-info-subtle text-info-text",
  primary: "bg-primary-subtle text-primary-text",
};

/** Pill-shaped, on purpose — a badge is exactly the "status/tag/compact
 *  metadata" case the brief carves out as the one place full rounding
 *  belongs. Everything else (buttons, inputs, cards) stays a rectangle. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A small coloured dot — for severity in a long list, where a badge per row is noise. */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-subtle",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    primary: "bg-primary",
  };
  return <span aria-hidden className={cx("inline-block size-2 rounded-full", tones[tone])} />;
}

/**
 * The product's status vocabulary, in one place (§48).
 *
 * The same state must read the same way everywhere: an instructor is INACTIVE,
 * never "Disabled" on one page and "Off" on another. Adding a status here is
 * deliberately more effort than inventing a word in a component, because
 * inventing the word is how three names for one state happen.
 */
export const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: "Active", tone: "success" },
  INACTIVE: { label: "Inactive", tone: "neutral" },
  // Distinct from INACTIVE on purpose: a historical report shows people who
  // have left, and "Former" says that plainly where "Inactive" reads like a
  // temporary state.
  FORMER: { label: "Former", tone: "neutral" },
  ON_LEAVE: { label: "On leave", tone: "info" },
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  PLANNED: { label: "Planned", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  AT_RISK: { label: "At risk", tone: "warning" },
  ON_TRACK: { label: "On track", tone: "success" },
  NEW: { label: "New", tone: "primary" },
  READ: { label: "Read", tone: "neutral" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
  LOW: { label: "Low", tone: "info" },
  MEDIUM: { label: "Medium", tone: "warning" },
  HIGH: { label: "High", tone: "danger" },
  CRITICAL: { label: "Critical", tone: "danger" },
  MISSED_OPENING: { label: "Missed opening", tone: "danger" },
  MISSED_CLOSING: { label: "Missed closing", tone: "danger" },
  NO_DATA: { label: "No data", tone: "warning" },
};

/**
 * A status, rendered from the shared vocabulary.
 *
 * Unknown codes fall back to a humanised form rather than throwing — a new
 * server-side status should look plain, not break the page — but the fallback
 * is a signal that the code belongs in STATUS above.
 */
export function StatusPill({ status }: { status: string }) {
  const known = STATUS[status];
  if (known) return <Badge tone={known.tone}>{known.label}</Badge>;
  const humanised = status.toLowerCase().replaceAll("_", " ");
  return <Badge tone="neutral">{humanised.charAt(0).toUpperCase() + humanised.slice(1)}</Badge>;
}

/* ── Tone bands ────────────────────────────────────────────────────────── */

/**
 * Compliance carries a tone rather than being read as a bare percentage, and
 * the bands live here rather than being re-derived on each screen. Each band
 * has a WORD as well as a colour, because colour alone is not a status
 * indicator for anyone who cannot distinguish the hues (§21, §36).
 *
 * `utilizationTone` and `utilizationLabel` used to sit here too, and are gone
 * with the figure they coloured. Utilisation was recorded minutes over the
 * configured day: it never asked whether an hour was spent with students, so a
 * day of internal meetings scored exactly like a day of lectures, and it
 * routinely passed 100% — which is why one of its own bands read "Over
 * capacity". The product measures Working Hours instead, and an hours figure
 * is not a score, so it takes no tone. The bands themselves survive in
 * `server/analytics/bands.ts`, where the API and the AI context still use them
 * against `recordedHours`, honestly named.
 */
export function complianceTone(pct: number | null): Tone {
  if (pct === null) return "neutral";
  if (pct >= 90) return "success";
  if (pct >= 50) return "warning";
  return "danger";
}

export function complianceLabel(pct: number | null): string {
  if (pct === null) return "Not measurable";
  if (pct >= 90) return "Compliant";
  if (pct >= 50) return "Needs attention";
  return "At risk";
}

/** Shared with `data.tsx`, which colours a figure by the same bands. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-content",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
};
