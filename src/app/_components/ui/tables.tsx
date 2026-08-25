/**
 * Tables, and the card list that replaces them on a phone.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import { cx } from "@/app/_components/ui/cx";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronRight,
} from "@/app/_components/icons";

/* ── Tables ────────────────────────────────────────────────────────────── */

/**
 * The column rule every cell carries.
 *
 * `last:border-r-0` rather than counting columns: a row can end on a cell with
 * a `colSpan`, so "which cell is last" is not a fixed index, and asking the DOM
 * is what keeps the final column off whatever border the surrounding card
 * already draws.
 */
const COLUMN_RULE = "border-r border-line last:border-r-0";

/**
 * The box a table scrolls inside — both ways.
 *
 * Wide tables scroll sideways in here so the page body never does. It is also
 * height-bounded, which is what lets `THead` stick: `top-0` is measured against
 * the nearest scrolling ancestor, so without a bound here the header would be
 * pinned to a box that never scrolls and would simply travel off the top of the
 * screen with the page. A short table is unaffected — the cap only engages once
 * there is more table than room.
 */
export function TableWrap({
  children,
  maxHeight = "70vh",
}: {
  children: ReactNode;
  /**
   * How tall the box may get before it scrolls instead.
   *
   * 70vh suits a table that IS the page. A table sharing a screen with other
   * panels wants a shorter one, so its height is set by the layout rather than
   * by how much data happens to be in it — a card that grows with its contents
   * pushes everything below it around.
   *
   * An inline style rather than a class: Tailwind cannot generate a utility for
   * a value that only exists at runtime.
   */
  maxHeight?: string;
}) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      {children}
    </div>
  );
}

export function Table({ caption, children }: { caption?: string; children: ReactNode }) {
  return (
    /* `border-separate` rather than the default collapse, because a collapsed
       table drops `position: sticky` on its cells and the header would not
       stick at all. The cost is that `<tr>` borders stop painting under that
       model, which is why the row rules live on `TD` below and why `divide-y`
       is gone from here and from `TBody`. */
    <table className="min-w-full border-separate border-spacing-0 text-sm">
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
    <thead>
      <tr>
        {columns.map((c) => {
          const sortable = Boolean(c.sortKey && onSort);
          const active = sort?.key === c.sortKey;
          const base = cx(
            COLUMN_RULE,
            /* `bg-primary-subtle` sits on the CELL, not on the `<thead>`: a
               thead's background does not paint behind a sticky cell, so the
               header would be transparent and the rows would scroll visibly
               through it rather than under it. */
            "sticky top-0 z-10 border-b border-line bg-primary-subtle",
            "text-xs font-semibold uppercase tracking-wide text-primary-text",
            c.align === "right" ? "text-right" : "text-left",
          );
          /* Padding is NOT in `base`. A sortable header puts it on the button
             inside instead, so that the whole cell is the click target — and
             the cell used to say `p-0` beside `base`'s `px-4` to cancel it,
             which is not a cancellation: both are padding, `.px-4` is emitted
             after `.p-0`, so the cell kept its 16px and the button added
             another 16 on top. Sortable columns sat a step further in than the
             rest of the header. Each branch now names its own. */

          if (!sortable) {
            return (
              <th key={c.label} scope="col" className={cx(base, "px-4 py-2.5")}>
                {c.label}
              </th>
            );
          }

          return (
            <th
              key={c.label}
              scope="col"
              className={base}
              aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
            >
              <button
                type="button"
                onClick={() => onSort!(c.sortKey!)}
                className={cx(
                  "flex w-full items-center gap-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-text",
                  "transition-colors hover:bg-primary/10",
                  c.align === "right" ? "justify-end" : "justify-start",
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
  // Row rules are on the cells — see the note in `Table`.
  return <tbody>{children}</tbody>;
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
        COLUMN_RULE,
        // The row rule, which used to be `divide-y` on `TBody` — see `Table`.
        "border-b border-line",
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
