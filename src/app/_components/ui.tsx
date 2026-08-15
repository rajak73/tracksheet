/**
 * Shared UI primitives.
 *
 * One definition per pattern. A page that needs a button imports one rather
 * than describing one — that is what keeps this looking like one product built
 * by one team rather than fourteen pages built in sequence.
 *
 * Colours are semantic tokens (`bg-surface`, `text-muted`) from globals.css,
 * never raw palette steps, so light and dark cannot drift apart one component
 * at a time. Radii are role-named (`rounded-control`, `rounded-card`,
 * `rounded-chip`) for the same reason: a card and a button should not be able
 * to disagree about how round things are.
 *
 * Nothing in this file computes a business number. Components take values the
 * server calculated and render them; the only derived thing here is TONE —
 * which colour a number wears — and those bands live in one place at the
 * bottom rather than being re-decided per screen.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconAlert,
  IconArrowDown,
  IconArrowUp,
  IconCheck,
  IconChevronRight,
  IconEmpty,
  IconInfo,
  IconSearch,
} from "@/app/_components/icons";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Page scaffolding ──────────────────────────────────────────────────── */

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? <div className="mb-3 text-sm text-muted">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Sans, not the display serif. The serif is reserved for the
              NEXTWAVE wordmark alone — a serif page title inside a data
              dashboard reads editorial rather than operational, and left the
              login screen mixing a sans headline with a serif one. */}
          <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          // `min-w-0` overrides the flex default of `min-width: auto`, which
          // otherwise refuses to shrink this block below its CONTENT's natural
          // width (e.g. two university/action pickers side by side) — without
          // it, wide actions content overflows the viewport horizontally on a
          // narrow screen instead of the `flex-wrap` below actually engaging.
          // Shrinking is only disabled again from `sm:` up, where there is
          // reliably enough room to share the row with the title unsquished.
          <div className="flex min-w-0 w-full shrink flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * Deep navigation only. A top-level page gets no breadcrumb, because
 * "Instructors" above a page titled "Instructors" is noise (§45).
 */
export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-1.5">
          {i > 0 ? <IconChevronRight size={16} className="text-subtle" /> : null}
          {item.href ? (
            <Link href={item.href} className="rounded-chip hover:text-content hover:underline">
              {item.label}
            </Link>
          ) : (
            <span className="text-content">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Groups a page into labelled bands, so a long detail page stays scannable. */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* ── Surfaces ──────────────────────────────────────────────────────────── */

export function Card({
  children,
  className,
  padded = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-card border border-line bg-surface shadow-card",
        padded && "p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-content">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("p-5", className)}>{children}</div>;
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-control font-medium " +
  "transition-[background-color,box-shadow,transform] duration-150 active:translate-y-px " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0";

/* Solid variants carry a faint shadow that firms up on hover and a one-pixel
   press on click — restrained tactile feedback, not a bounce. Restraint is
   the point: a fully flat button reads inert, a springy one reads like a
   template's idea of "delightful". */
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-card hover:bg-primary-hover hover:shadow-raised",
  secondary: "border border-line-strong bg-surface text-content hover:bg-hovered",
  ghost: "text-muted hover:bg-hovered hover:text-content",
  danger: "bg-danger text-white shadow-card hover:opacity-90 hover:shadow-raised",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-sm",
  md: "px-3.5 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
    />
  );
}

/**
 * Same visual language as Button, for navigation.
 *
 * Uses next/link by default so in-app navigation is client-side; pass
 * `external` for a download or an API URL, which needs a real document request.
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  href,
  external = false,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href: string;
  external?: boolean;
}) {
  const classes = cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
  if (external) {
    return (
      <a href={href} {...props} className={classes}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...props} className={classes}>
      {children}
    </Link>
  );
}

/**
 * An icon-only control.
 *
 * `label` is REQUIRED and becomes both the accessible name and the tooltip.
 * An icon button without one is unusable with a screen reader and ambiguous
 * with a mouse, so the type system refuses to build one (§11, §36).
 */
export function IconButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-9 items-center justify-center rounded-control text-muted",
        "transition-colors hover:bg-hovered hover:text-content disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── Forms ─────────────────────────────────────────────────────────────── */

export const inputClass =
  "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-content " +
  "placeholder:text-subtle focus:border-primary focus:outline-none " +
  "focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block text-sm", className)}>
      <span className="mb-1.5 flex items-center gap-1 font-medium text-content">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden>
            *
          </span>
        ) : null}
        {required ? <span className="sr-only-text">(required)</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger-text">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/** A native select wearing the same skin as every other control. */
export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputClass, "appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cx("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-subtle">
        <IconSearch size={16} />
      </span>
      <input
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, "pl-9")}
      />
    </div>
  );
}

/**
 * A form section with its own heading.
 *
 * Long forms are grouped rather than presented as one column of inputs (§26):
 * identity, then working configuration, then account status. The grouping is
 * what makes a twelve-field form feel like three short ones.
 */
export function FieldGroup({
  title,
  description,
  columns = 4,
  children,
}: {
  title: string;
  description?: string;
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  const grid = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className={cx("grid grid-cols-1 gap-4", grid)}>{children}</CardBody>
    </Card>
  );
}

/** A row of filters that can be cleared as a unit (§46). */
export function FilterBar({
  children,
  onClear,
  isFiltered,
}: {
  children: ReactNode;
  onClear?: () => void;
  isFiltered?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-4 shadow-card">
      {children}
      {onClear && isFiltered ? (
        <Button variant="ghost" size="sm" onClick={onClear} className="ml-auto">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Page controls for a server-paginated list.
 *
 * Renders nothing when everything already fits on one page — `total <= limit`
 * with `page === 1` — so a small university's roster never grows a Previous/
 * Next bar it can't use. `hasMore` (not a client-computed `page < totalPages`)
 * decides whether Next is enabled, matching exactly what the API itself
 * asserted the page after this one contains.
 */
export function Pagination({
  page,
  limit,
  total,
  hasMore,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  onPageChange: (page: number) => void;
}) {
  if (page === 1 && !hasMore) return null;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
      <span className="text-sm text-muted">
        Page {page} of {totalPages} &middot; {total} total
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!hasMore}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* ── Feedback ──────────────────────────────────────────────────────────── */

const ALERT_ICON = {
  danger: IconAlert,
  warning: IconAlert,
  success: IconCheck,
  info: IconInfo,
} as const;

export function Alert({
  tone = "danger",
  title,
  children,
  actions,
}: {
  tone?: "danger" | "warning" | "success" | "info";
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const tones = {
    danger: "border-danger/30 bg-danger-subtle text-danger-text",
    warning: "border-warning/30 bg-warning-subtle text-warning-text",
    success: "border-success/30 bg-success-subtle text-success-text",
    info: "border-info/30 bg-info-subtle text-info-text",
  } as const;
  const Glyph = ALERT_ICON[tone];

  return (
    <div
      className={cx("flex gap-3 rounded-control border px-4 py-3 text-sm", tones[tone])}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Glyph size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/**
 * An empty list is a normal state, not a failure. Each one says what is
 * missing and, where there is one, offers the action that fills it — so a
 * fresh university reads as "ready to set up" rather than "broken" (§29).
 */
export function EmptyState({
  title,
  description,
  action,
  icon = true,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: boolean;
}) {
  return (
    <div className="px-5 py-12 text-center">
      {icon ? (
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-card bg-sunken text-subtle">
          <IconEmpty size={20} />
        </div>
      ) : null}
      <p className="text-sm font-medium text-content">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * A failure the user can act on.
 *
 * The message is written for a university administrator, not for whoever reads
 * the logs. Status codes and stack traces stay out of it (§31, §49); `detail`
 * exists for the rare case where the SERVER's own reason is genuinely
 * actionable ("endTime must be after startTime").
 */
export function ErrorState({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <Card padded>
      <div className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-danger">
          <IconAlert size={20} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-content">{message}</p>
          <p className="mt-1 text-sm text-muted">
            {detail ?? "Something went wrong while retrieving this information."}
          </p>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ── Loading ───────────────────────────────────────────────────────────── */

/**
 * Skeletons mirror the shape of what replaces them, so the page does not jump
 * when data lands (§30). A centred spinner would be less work and worse.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-chip bg-sunken", className)} />;
}

export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <Card>
      <div className="border-b border-line px-5 py-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 px-5 py-3.5">
            {Array.from({ length: cols }, (_, c) => (
              <Skeleton key={c} className={cx("h-4", c === 0 ? "w-40" : "w-16")} />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

export function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <Card>
      <div className="border-b border-line px-5 py-4">
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="p-5">
        {/* Uniform bars rather than randomised heights: a skeleton that
            reshuffles on every render reads as the page glitching. */}
        <div className="flex items-end gap-1" style={{ height }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Skeleton key={i} className="h-full flex-1" />
          ))}
        </div>
      </div>
    </Card>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <StatGridSkeleton />
      <TableSkeleton />
    </div>
  );
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
 * Utilisation and compliance are the numbers this product exists to surface,
 * so they carry a tone rather than being read as bare percentages. The bands
 * live here, in one place, rather than being re-derived on each screen.
 *
 * Each band has a WORD as well as a colour, because colour alone is not a
 * status indicator for anyone who cannot distinguish the hues (§21, §36).
 */
export function utilizationTone(pct: number | null): Tone {
  if (pct === null) return "neutral";
  if (pct > 100) return "danger";
  if (pct >= 75) return "success";
  if (pct >= 60) return "warning";
  return "danger";
}

export function utilizationLabel(pct: number | null): string {
  if (pct === null) return "Not measurable";
  if (pct > 100) return "Over capacity";
  if (pct >= 75) return "On track";
  if (pct >= 60) return "Below target";
  return "Low utilization";
}

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

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-content",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
};

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

/* ── Tables ────────────────────────────────────────────────────────────── */

export function TableWrap({ children }: { children: ReactNode }) {
  // Wide tables scroll inside their own container so the page body never does.
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    <table className="min-w-full divide-y divide-line text-sm">
      {caption ? <caption className="sr-only-text">{caption}</caption> : null}
      {children}
    </table>
  );
}

export type SortDirection = "asc" | "desc";

export type Column = {
  label: string;
  align?: "right";
  /** Present when the column can be sorted; the value is the sort key. */
  sortKey?: string;
};

/**
 * A table head, optionally sortable (§25).
 *
 * Sorting is a presentation concern and is done in the page over data the
 * server already returned — it never triggers a refetch, so it costs nothing
 * and cannot disagree with the totals above the table.
 */
export function THead({
  columns,
  sort,
  onSort,
}: {
  columns: Column[];
  sort?: { key: string; direction: SortDirection };
  onSort?: (key: string) => void;
}) {
  return (
    <thead className="bg-sunken/50">
      <tr>
        {columns.map((c) => {
          const sortable = Boolean(c.sortKey && onSort);
          const active = sort?.key === c.sortKey;
          const base = cx(
            "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted",
            c.align === "right" ? "text-right" : "text-left",
          );

          if (!sortable) {
            return (
              <th key={c.label} scope="col" className={base}>
                {c.label}
              </th>
            );
          }

          return (
            <th
              key={c.label}
              scope="col"
              className={cx(base, "p-0")}
              aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
            >
              <button
                type="button"
                onClick={() => onSort!(c.sortKey!)}
                className={cx(
                  "flex w-full items-center gap-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide",
                  "transition-colors hover:bg-hovered hover:text-content",
                  c.align === "right" ? "justify-end" : "justify-start",
                  active ? "text-content" : "text-muted",
                )}
              >
                {c.label}
                {active ? (
                  sort!.direction === "asc" ? (
                    <IconArrowUp size={16} />
                  ) : (
                    <IconArrowDown size={16} />
                  )
                ) : null}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({
  children,
  selected,
  onClick,
}: {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={cx(
        "transition-colors",
        selected ? "bg-primary-subtle" : "hover:bg-hovered",
        onClick && "cursor-pointer",
      )}
    >
      {children}
    </tr>
  );
}

export function TD({
  children,
  align,
  strong,
  className,
  colSpan,
}: {
  children: ReactNode;
  align?: "right";
  strong?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        "px-4 py-3",
        align === "right" ? "text-right tabular" : "",
        strong ? "font-medium text-content" : "text-muted",
        className,
      )}
    >
      {children}
    </td>
  );
}

/**
 * The mobile half of a data table (§34).
 *
 * Below `md`, a nine-column table is not shrunk — it is replaced by a list of
 * cards carrying the two or three fields that matter, with the rest available
 * by drilling in. Pages render both and toggle with `hidden md:block` /
 * `md:hidden`, which keeps the desktop table honest markup rather than a grid
 * pretending to be one.
 */
export function CardList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>;
}

export function CardListItem({
  title,
  subtitle,
  meta,
  trailing,
  href,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-content">{title}</div>
        {subtitle ? <div className="mt-0.5 text-sm text-muted">{subtitle}</div> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {trailing}
        {href ? <IconChevronRight size={16} className="text-subtle" /> : null}
      </div>
    </div>
  );

  return (
    <li>
      {href ? (
        <Link href={href} className="block transition-colors hover:bg-hovered">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}
