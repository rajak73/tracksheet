/**
 * Shared UI primitives.
 *
 * Pages were built across ten phases, and each one styled its own buttons,
 * cards and tables with slightly different Tailwind. This module is the single
 * definition of each pattern; a page that needs a button imports one rather
 * than describing one. That is what keeps the product looking like one product.
 *
 * Colours here are semantic tokens (`bg-surface`, `text-muted`) defined in
 * globals.css, never raw palette steps, so light and dark cannot drift apart
 * one component at a time.
 */

import Link from "next/link";
import type { ReactNode } from "react";

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
          <h1 className="text-2xl font-semibold tracking-tight text-content sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden className="text-subtle">/</span> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-content hover:underline">
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
        "overflow-hidden rounded-xl border border-line bg-surface shadow-card",
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
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
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
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-content hover:bg-hovered",
  ghost: "text-muted hover:bg-hovered hover:text-content",
  danger: "bg-danger text-white hover:opacity-90",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
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

/** Same visual language as Button, for navigation and downloads. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href: string;
}) {
  return (
    <a
      href={href}
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
    >
      {children}
    </a>
  );
}

/* ── Forms ─────────────────────────────────────────────────────────────── */

export const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-content " +
  "placeholder:text-subtle focus:border-primary focus:outline-none " +
  "focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block text-sm", className)}>
      <span className="mb-1.5 block font-medium text-content">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {children}
      </CardBody>
    </Card>
  );
}

/* ── Feedback ──────────────────────────────────────────────────────────── */

export function Alert({
  tone = "danger",
  title,
  children,
}: {
  tone?: "danger" | "warning" | "success" | "info";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    danger: "border-danger/30 bg-danger-subtle text-danger-text",
    warning: "border-warning/30 bg-warning-subtle text-warning-text",
    success: "border-success/30 bg-success-subtle text-success-text",
    info: "border-info/30 bg-info-subtle text-info-text",
  } as const;

  return (
    <div className={cx("rounded-lg border px-4 py-3 text-sm", tones[tone])} role="status">
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? "mt-0.5" : undefined}>{children}</div>
    </div>
  );
}

/**
 * An empty list is a normal state, not a failure. Each one says what is
 * missing and, where there is one, offers the action that fills it — so a
 * fresh university reads as "ready to set up" rather than "broken".
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-content">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Card padded>
      <p className="text-sm font-medium text-danger-text">Something went wrong</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
    </Card>
  );
}

/* ── Loading ───────────────────────────────────────────────────────────── */

/**
 * Skeletons mirror the shape of what replaces them, so the page does not jump
 * when data lands. A centred spinner would be less work and worse.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-sunken", className)} />;
}

export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-16" />
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

/* ── Data display ──────────────────────────────────────────────────────── */

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

const BADGE_TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-muted",
  success: "bg-success-subtle text-success-text",
  warning: "bg-warning-subtle text-warning-text",
  danger: "bg-danger-subtle text-danger-text",
  info: "bg-info-subtle text-info-text",
  primary: "bg-primary-subtle text-primary-text",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A small coloured dot — for severity in a long list, where a full badge per row is noise. */
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
 * Utilisation and compliance are the numbers this product exists to surface,
 * so they carry a tone rather than being read as bare percentages. The bands
 * are here, in one place, rather than re-derived on each screen.
 */
export function utilizationTone(pct: number | null): Tone {
  if (pct === null) return "neutral";
  if (pct > 100) return "danger";
  if (pct >= 75) return "success";
  if (pct >= 60) return "warning";
  return "danger";
}

export function complianceTone(pct: number | null): Tone {
  if (pct === null) return "neutral";
  if (pct >= 90) return "success";
  if (pct >= 50) return "warning";
  return "danger";
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-content",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  primary: "text-primary",
};

/**
 * A single headline number.
 *
 * `null` renders as "Not measurable", never as 0 — the distinction between
 * "we measured zero" and "there is nothing to measure" is load-bearing
 * throughout this product and must survive to the screen.
 */
export function StatTile({
  label,
  value,
  suffix,
  tone = "neutral",
  hint,
  emphasis = false,
}: {
  label: string;
  value: number | string | null;
  suffix?: string;
  tone?: Tone;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
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
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Horizontal bar for a percentage — makes a table of utilisation scannable. */
export function Meter({ value, tone = "primary" }: { value: number | null; tone?: Tone }) {
  const tones: Record<Tone, string> = {
    neutral: "bg-subtle",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    primary: "bg-primary",
  };
  if (value === null) return <span className="text-sm text-subtle">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken">
        <div className={cx("h-full rounded-full", tones[tone])} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="tabular text-sm text-content">{value}%</span>
    </div>
  );
}

/* ── Tables ────────────────────────────────────────────────────────────── */

export function TableWrap({ children }: { children: ReactNode }) {
  // Wide tables scroll inside their own container so the page body never does.
  return <div className="overflow-x-auto">{children}</div>;
}

export function Table({ children }: { children: ReactNode }) {
  return <table className="min-w-full divide-y divide-line text-sm">{children}</table>;
}

export function THead({ columns }: { columns: Array<{ label: string; align?: "right" }> }) {
  return (
    <thead className="bg-sunken/50">
      <tr>
        {columns.map((c) => (
          <th
            key={c.label}
            scope="col"
            className={cx(
              "px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted",
              c.align === "right" ? "text-right" : "text-left",
            )}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>;
}

export function TR({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-hovered">{children}</tr>;
}

export function TD({
  children,
  align,
  strong,
  className,
}: {
  children: ReactNode;
  align?: "right";
  strong?: boolean;
  className?: string;
}) {
  return (
    <td
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
