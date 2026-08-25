/**
 * Interactive primitives — the ones that need state, effects or a portal.
 *
 * Kept apart from ui.tsx so that file stays usable from server components: a
 * `"use client"` on the shared primitives would drag every page that renders a
 * Card across the client boundary.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useUniversityToday } from "@/app/_lib/zone";
import {
  Badge,
  Button,
  IconButton,
  Select,
  StatusPill,
  type Tone,
  inputClass,
} from "@/app/_components/ui";
import { IconAlert, IconCheck, IconClose, IconInfo } from "@/app/_components/icons";

/* ── Dialog ────────────────────────────────────────────────────────────── */

/**
 * A modal, built on the native `<dialog>` element.
 *
 * `showModal()` gives focus trapping, Escape-to-close, inertness of the page
 * behind, and focus restoration on close — all things a hand-rolled div modal
 * gets wrong, and all of them accessibility requirements (§36).
 *
 * Reserved for focus: confirmations, destructive actions and compact forms. A
 * multi-step workflow does not belong in one of these (§33).
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  dividers = true,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Optional mark beside the title. Decorative — the title carries the meaning. */
  icon?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /**
   * Rules between the header, the body and the footer. On by default — they
   * separate three regions that are doing different jobs. The client's work-log
   * design is one continuous white sheet, so that screen turns them off.
   */
  dividers?: boolean;
  /** `lg` for a form with four fields in it; `md` for a question or a confirm. */
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself, never on
      // its content — so this closes on backdrop click without a second
      // listener on the page.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // `m-auto` is load-bearing: a native modal <dialog> centres itself via
      // `margin: auto`, and Tailwind's preflight resets every margin to 0 —
      // which silently pinned this to the top-left corner of the viewport.
      className={`m-auto w-[calc(100vw-2rem)] ${size === "lg" ? "max-w-2xl" : "max-w-lg"} rounded-card border border-line bg-surface p-0 text-content shadow-raised backdrop:bg-black/40`}
    >
      <div className={`flex items-start justify-between gap-4 px-5 py-4 ${dividers ? "border-b border-line" : ""}`}>
        <div className="flex min-w-0 items-start gap-3">
          {icon ? (
            <span aria-hidden className="mt-0.5 shrink-0 text-primary-text">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-content">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
        </div>
        <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1">
          <IconClose size={20} />
        </IconButton>
      </div>

      {children ? <div className="px-5 py-4 text-sm">{children}</div> : null}

      {footer ? (
        <div className={`flex flex-wrap justify-end gap-2 px-5 py-4 ${dividers ? "border-t border-line" : ""}`}>
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

/** The common case: "are you sure?" before something irreversible. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-muted">{description}</p>
    </Dialog>
  );
}

/* ── Toasts ────────────────────────────────────────────────────────────── */

type ToastTone = "success" | "danger" | "info";
/**
 * `title` is optional, and the difference is a real one rather than a style.
 *
 * With one, the toast says what HAPPENED in a bolded line and what that means
 * underneath it — "Great job!" over "Your work log for today has been
 * submitted successfully." Without one it is a single sentence, which is right
 * for the small confirmations ("Entry removed successfully.") that would look
 * self-important with a headline over them.
 */
type Toast = { id: number; tone: ToastTone; message: string; title?: string };

const ToastContext = createContext<
  ((tone: ToastTone, message: string, title?: string) => void) | null
>(null);

/**
 * Transient confirmation of something that already happened (§32).
 *
 * Deliberately NOT for anything the user must be able to re-read: a validation
 * error stays next to the field, and a warning about missing data stays on the
 * page as an Alert. A toast that carries information you need twice is a bug.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);

  const push = useCallback((tone: ToastTone, message: string, title?: string) => {
    const id = next.current++;
    setToasts((current) => [...current, { id, tone, message, title }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const tones: Record<ToastTone, string> = {
    success: "border-success/30 bg-success-subtle text-success-text",
    danger: "border-danger/30 bg-danger-subtle text-danger-text",
    info: "border-info/30 bg-info-subtle text-info-text",
  };
  const glyphs = { success: IconCheck, danger: IconAlert, info: IconInfo };
  /* The disc behind the glyph: the tone at full strength, which the pale
     surface it sits on is a tint of. */
  const discs: Record<ToastTone, string> = {
    success: "bg-success",
    danger: "bg-danger",
    info: "bg-info",
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Polite: a save confirmation should not interrupt what is being read. */}
      {/* Top, not bottom. A confirmation belongs where the eye already is
          after pressing a button in a dialog — the bottom-right corner of a
          tall page is somewhere nobody was looking, and a message that times
          out unseen is the same as no message. z-[60] keeps it over the
          chrome, per the layer scale in globals.css. */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((t) => {
          const Glyph = glyphs[t.tone];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-card border px-4 py-3 text-sm shadow-raised ${tones[t.tone]}`}
            >
              {/* A filled disc rather than a bare tick: at 16px on a pale
                  ground the glyph alone reads as decoration, and the disc is
                  what makes the tone legible before the words are. */}
              <span
                className={`mt-px flex size-9 shrink-0 items-center justify-center rounded-full ${discs[t.tone]}`}
              >
                <Glyph size={20} className="text-white" />
              </span>
              <span className="flex-1">
                {t.title ? <span className="block font-bold">{t.title}</span> : null}
                <span className="block text-content">{t.message}</span>
              </span>
              <button
                onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}
                aria-label="Dismiss"
                className="shrink-0 rounded-chip opacity-60 hover:opacity-100"
              >
                <IconClose size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Returns a `toast(tone, message)` function.
 *
 * Falls back to a no-op outside a provider rather than throwing: a missing
 * provider should cost a confirmation message, not crash the page the user was
 * working on.
 */
export function useToast() {
  const push = useContext(ToastContext);
  return useCallback(
    (tone: ToastTone, message: string, title?: string) => push?.(tone, message, title),
    [push],
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */

/**
 * Tabs, used only where they REDUCE complexity — a detail page with four
 * genuinely independent views, not a way to hide a long page (§28).
 */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              selected
                ? "border-primary text-content"
                : "border-transparent text-muted hover:text-content"
            }`}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="tabular rounded-pill bg-sunken px-1.5 py-0.5 text-xs text-muted">
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ── Period selector ───────────────────────────────────────────────────── */

export type Period = { from: string; to: string };

/**
 * The presets, resolved against a given "today".
 *
 * A function of the day rather than a constant, because "Today" has to mean the
 * UNIVERSITY's today. Read from the browser it labels yesterday's rows "Today"
 * for the hours the two zones disagree — which for an Indian university and a
 * UTC-set machine is every evening.
 */
const presetsFor = (today: string): Array<{ id: string; label: string; resolve: () => Period }> => [
  { id: "today", label: "Today", resolve: () => ({ from: today, to: today }) },
  { id: "7d", label: "Last 7 days", resolve: () => ({ from: daysBefore(today, 6), to: today }) },
  { id: "30d", label: "Last 30 days", resolve: () => ({ from: daysBefore(today, 29), to: today }) },
  { id: "90d", label: "Last 90 days", resolve: () => ({ from: daysBefore(today, 89), to: today }) },
];

/** Calendar arithmetic on a date string — no instant, so no zone to get wrong. */
function daysBefore(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

/**
 * The one period control (§47).
 *
 * `value === null` means "let the server choose", which is how every page in
 * this product starts: the backend resolves the current period in the
 * UNIVERSITY's timezone, and the browser's idea of today is not authoritative.
 * Only once the user picks a range does the client send explicit dates — and
 * even then they are dates, not instants, so no timezone is smuggled along.
 */
export function PeriodSelector({
  value,
  onChange,
  defaultLabel = "Current period",
}: {
  value: Period | null;
  onChange: (next: Period | null) => void;
  defaultLabel?: string;
}) {
  const today = useUniversityToday();
  const PRESETS = presetsFor(today);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<Period | null>(null);
  const range = draft ?? { from: daysBefore(today, 6), to: today };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Period"
        value={custom ? "custom" : (value ? matchPreset(value, today) : "default")}
        onChange={(e) => {
          const id = e.target.value;
          if (id === "default") {
            setCustom(false);
            onChange(null);
            return;
          }
          if (id === "custom") {
            setCustom(true);
            onChange(draft);
            return;
          }
          setCustom(false);
          const preset = PRESETS.find((p) => p.id === id);
          if (preset) onChange(preset.resolve());
        }}
        className="w-auto min-w-40"
      >
        <option value="default">{defaultLabel}</option>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom range…</option>
      </Select>

      {custom ? (
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="From date"
            value={range.from}
            max={range.to}
            onChange={(e) => {
              const nextDraft = { ...range, from: e.target.value };
              setDraft(nextDraft);
              onChange(nextDraft);
            }}
            className={`${inputClass} w-auto`}
          />
          <span className="text-sm text-subtle">to</span>
          <input
            type="date"
            aria-label="To date"
            value={range.to}
            min={range.from}
            onChange={(e) => {
              const nextDraft = { ...range, to: e.target.value };
              setDraft(nextDraft);
              onChange(nextDraft);
            }}
            className={`${inputClass} w-auto`}
          />
        </div>
      ) : null}
    </div>
  );
}

function matchPreset(period: Period, today: string): string {
  const hit = presetsFor(today).find((p) => {
    const r = p.resolve();
    return r.from === period.from && r.to === period.to;
  });
  return hit?.id ?? "custom";
}

/** Turns a period into the query string every analytics endpoint accepts. */
export function periodQuery(period: Period | null): string {
  return period ? `?from=${period.from}&to=${period.to}` : "";
}

/* ── AI insight ────────────────────────────────────────────────────────── */

const SEVERITY_TONE: Record<string, Tone> = {
  CRITICAL: "danger",
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "info",
  INFO: "info",
  // A workforce tool that can only ever report problems trains its readers to
  // dismiss it, and "this improved" is a real finding. Same card, green accent.
  POSITIVE: "success",
};

const SEVERITY_ACCENT: Record<string, string> = {
  CRITICAL: "border-l-danger",
  HIGH: "border-l-danger",
  MEDIUM: "border-l-warning",
  LOW: "border-l-info",
  INFO: "border-l-info",
  POSITIVE: "border-l-success",
};

export type Insight = {
  id?: string;
  type: string;
  severity: string;
  title?: string;
  summary?: string;
  recommendation: string;
  period?: string;
  status?: string;
  /** The exact metric snapshot the text was derived from. */
  sourceMetrics?: Record<string, unknown> | null;
};

/** Only numeric metrics are shown as figures; anything else stays out. */
function metricRows(metrics: Record<string, unknown> | null | undefined) {
  if (!metrics) return [];
  return Object.entries(metrics)
    .filter(([, v]) => typeof v === "number")
    .slice(0, 4)
    .map(([k, v]) => ({
      label: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim(),
      value: v as number,
    }));
}

/**
 * One AI insight, as a structured card rather than a paragraph (§23).
 *
 * The important property is that the SUPPORTING METRICS are shown next to the
 * narration. The text is generated; the numbers are not. Putting them side by
 * side is what makes the insight checkable rather than something to be taken on
 * faith — and it is the product rule that AI output must always be traceable to
 * the calculated metric it came from.
 *
 * One component with severity variants, not five different card designs (§24).
 */
export function InsightCard({
  insight,
  action,
  onDismiss,
}: {
  insight: Insight;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const tone = SEVERITY_TONE[insight.severity] ?? "neutral";
  const accent = SEVERITY_ACCENT[insight.severity] ?? "border-l-line-strong";
  const metrics = metricRows(insight.sourceMetrics);

  return (
    <article
      className={`rounded-card border border-l-4 border-line bg-surface p-5 shadow-card ${accent}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{insight.severity}</Badge>
            {insight.status ? <StatusPill status={insight.status} /> : null}
            {insight.period ? (
              <span className="tabular text-xs text-subtle">{insight.period}</span>
            ) : null}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-content">
            {insight.title ?? insight.type.replaceAll("_", " ")}
          </h3>
        </div>
        {onDismiss ? (
          <IconButton label="Dismiss insight" onClick={onDismiss} className="-mr-2 -mt-1">
            <IconClose size={16} />
          </IconButton>
        ) : null}
      </div>

      {insight.summary ? (
        <p className="mt-2 text-sm text-muted">{insight.summary}</p>
      ) : null}

      {metrics.length > 0 ? (
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.map((m) => (
            <div key={m.label} className="rounded-control bg-sunken px-3 py-2">
              <dt className="truncate text-xs text-muted">{m.label}</dt>
              <dd className="tabular mt-0.5 text-sm font-semibold text-content">{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          Recommended action
        </p>
        <p className="mt-1 text-sm text-content">{insight.recommendation}</p>
      </div>

      {/* Stated on every card, not buried in a footnote once per page. An
          insight is a detection over recorded activity, and it should never
          read as a settled fact about a person. */}
      <p className="mt-3 text-xs text-subtle">
        Detected from recorded activity in this period. Review the underlying records before
        acting.
      </p>

      {action ? <div className="mt-4">{action}</div> : null}
    </article>
  );
}

/** Severity counts across a list, so a page can lead with what matters (§24). */
export function useSeverityCounts(insights: Insight[]) {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of insights) counts[i.severity] = (counts[i.severity] ?? 0) + 1;
    return counts;
  }, [insights]);
}
