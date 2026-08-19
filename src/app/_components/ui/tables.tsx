/**
 * Tables, and the card list that replaces them on a phone.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
} from "@/app/_components/icons";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
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
