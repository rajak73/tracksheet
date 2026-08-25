/**
 * Page scaffolding: the frame a screen sits in.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconChevronRight,
} from "@/app/_components/icons";

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
    <header className="mb-3">
      {/* The breadcrumb sits INSIDE the left column rather than in a band above
          the whole row, so `items-start` aligns the actions with the very top
          of the header instead of with the title underneath it. A page whose
          actions are figures rather than buttons — see the manager detail
          page — wants them level with the first line, not indented a
          breadcrumb's height down the page. With no breadcrumb the two are the
          same thing, which is every other caller. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {breadcrumb ? <div className="mb-2 text-[13px] text-muted">{breadcrumb}</div> : null}
          {/* Sans, not the display serif. The serif is reserved for the
              NIAT wordmark alone — a serif page title inside a data
              dashboard reads editorial rather than operational, and left the
              login screen mixing a sans headline with a serif one. */}
          <h1 className="text-lg font-semibold tracking-tight text-content sm:text-xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-xs text-muted">{description}</p>
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
