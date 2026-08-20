/**
 * Form controls, and the bars that filter and page a list.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import { cx } from "@/app/_components/ui/cx";
import { Button } from "@/app/_components/ui/buttons";
import { Card, CardBody, CardHeader } from "@/app/_components/ui/surfaces";

import type { ReactNode } from "react";
import {
  IconSearch,
} from "@/app/_components/icons";

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
