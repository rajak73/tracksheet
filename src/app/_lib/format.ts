/**
 * Display formatting.
 *
 * One definition per format, because the audit found the same value rendered
 * three ways: `2026-10-05`, `10/5/2026`, and `Mon Oct 05 2026`. A date that
 * changes shape between two pages makes a product feel assembled rather than
 * designed.
 *
 * These are PRESENTATION ONLY. Nothing here computes a duration, a total or a
 * capacity — those come from the server and are rendered exactly as received.
 * The one piece of real logic is timezone: an instant is shown in the
 * UNIVERSITY's zone, never the browser's, because a 09:00 class in Kolkata is
 * 09:00 to everyone who cares about it.
 */

/** `2026-10-05` → `5 Oct 2026`. Accepts a date-only string or a full ISO instant. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** `5 Oct` — for axis labels and dense tables where the year is already known. */
export function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

/** `Mon` — weekday alone, for day-of-week trend axes. */
export function formatWeekday(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date);
}

/** `5 Oct 2026 – 9 Oct 2026`, collapsing a shared month or year. */
export function formatRange(from: string, to: string): string {
  if (!from || !to) return "—";
  if (from === to) return formatDate(from);
  return `${formatDateShort(from)} – ${formatDate(to)}`;
}

/**
 * An instant, in the university's timezone.
 *
 * The zone is required rather than optional: making it default to the browser
 * is how "09:00" silently becomes "03:30" for an administrator in London
 * looking at an Indian university.
 */
export function formatTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

export function formatTimeRange(startIso: string, endIso: string, timeZone: string): string {
  return `${formatTime(startIso, timeZone)}–${formatTime(endIso, timeZone)}`;
}

/** Minutes past midnight (how working hours are stored) → `09:00`. */
export function formatMinuteOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Hours, with the unit attached. `null` is NOT zero — it is the absence of a
 * measurement, and it renders as an em dash so it can never be misread as a
 * quantity.
 */
export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}h`;
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value}%`;
}

/** A signed variance, for KPI comparisons: `+3.4h`, `−1.2h`, `No change`. */
export function formatDelta(value: number | null | undefined, unit = "h"): string {
  if (value === null || value === undefined) return "—";
  const rounded = Number(value.toFixed(1));
  if (rounded === 0) return "No change";
  const abs = Number.isInteger(rounded) ? Math.abs(rounded) : Math.abs(rounded).toFixed(1);
  return `${rounded > 0 ? "+" : "−"}${abs}${unit}`;
}

/** `DAILY_OPENING` → `Daily opening`. Codes never reach the screen raw. */
export function humanizeCode(code: string): string {
  if (!code) return "—";
  const lower = code.toLowerCase().replaceAll("_", " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The ISO date the browser currently sits on — only ever a form DEFAULT. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `n` days before today, as an ISO date. Used for period-selector presets. */
export function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
