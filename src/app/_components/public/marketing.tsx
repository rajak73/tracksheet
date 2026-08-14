/**
 * Marketing primitives for the public website.
 *
 * These are deliberately SEPARATE from `ui.tsx` (the product primitives)
 * while sharing the same design tokens. The two surfaces have opposite
 * jobs: the product is data-dense — small type, tight rows, many figures per
 * screen — and the marketing site is editorial, with a much larger type
 * scale and far more whitespace. Reusing `Card`/`PageHeader` here would drag
 * dashboard density onto a page that needs to breathe.
 *
 * What IS shared: every colour, radius, shadow and font token, plus
 * `ButtonLink` for CTAs. That is what keeps the public site and the
 * authenticated product recognisably one product.
 */

import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ── Page scaffolding ──────────────────────────────────────────────────── */

/**
 * A full-width band. `tone` sets the background step, which is how the page
 * gets its rhythm — alternating surface/canvas rather than wrapping every
 * section in a card.
 */
export function Band({
  tone = "canvas",
  className,
  children,
  id,
}: {
  tone?: "canvas" | "surface" | "navy" | "soft";
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const tones = {
    canvas: "bg-canvas",
    surface: "bg-surface",
    soft: "bg-primary-subtle",
    navy: "bg-sidebar-bg",
  } as const;

  return (
    <section id={id} className={cx("px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28", tones[tone], className)}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

/** Small uppercase label above a heading. */
export function Eyebrow({ children, onNavy }: { children: ReactNode; onNavy?: boolean }) {
  return (
    <p
      className={cx(
        "text-xs font-semibold uppercase tracking-[0.12em]",
        onNavy ? "text-primary-subtle/80" : "text-primary",
      )}
    >
      {children}
    </p>
  );
}

/**
 * A section heading block: eyebrow, heading, lede.
 *
 * `as` exists because heading LEVEL and visual SIZE are different concerns —
 * a page has exactly one `h1`, but several headings may want the same size.
 */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  as: Tag = "h2",
  align = "left",
  onNavy = false,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  as?: "h1" | "h2";
  align?: "left" | "center";
  onNavy?: boolean;
}) {
  return (
    <div className={cx("max-w-3xl", align === "center" && "mx-auto text-center")}>
      {eyebrow ? (
        <div className="mb-4">
          <Eyebrow onNavy={onNavy}>{eyebrow}</Eyebrow>
        </div>
      ) : null}
      <Tag
        className={cx(
          "text-balance font-semibold tracking-tight",
          Tag === "h1"
            ? "text-4xl sm:text-5xl lg:text-6xl"
            : "text-3xl sm:text-4xl lg:text-[2.75rem] lg:leading-[1.1]",
          onNavy ? "text-white" : "text-content",
        )}
      >
        {title}
      </Tag>
      {lede ? (
        <p
          className={cx(
            "mt-5 text-pretty text-lg leading-relaxed sm:text-xl",
            onNavy ? "text-sidebar-text-muted" : "text-muted",
          )}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}

/* ── Content blocks ────────────────────────────────────────────────────── */

/**
 * A capability/feature block.
 *
 * Bordered rather than shadowed, and only lightly rounded — the brief's
 * "not every piece of content needs to be inside a card" rule means these
 * are used for genuine grids of peers, not to box arbitrary prose.
 */
export function FeatureCard({
  icon,
  title,
  children,
  onNavy = false,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  onNavy?: boolean;
}) {
  return (
    <div
      className={cx(
        "rounded-card border p-6 transition-shadow",
        onNavy
          ? "border-white/10 bg-white/[0.04]"
          : "border-line bg-surface hover:shadow-card",
      )}
    >
      {icon ? (
        <div
          className={cx(
            "mb-4 flex size-10 items-center justify-center rounded-control",
            onNavy ? "bg-white/10 text-white" : "bg-primary-subtle text-primary",
          )}
        >
          {icon}
        </div>
      ) : null}
      <h3 className={cx("text-base font-semibold", onNavy ? "text-white" : "text-content")}>
        {title}
      </h3>
      <p
        className={cx(
          "mt-2 text-sm leading-relaxed",
          onNavy ? "text-sidebar-text-muted" : "text-muted",
        )}
      >
        {children}
      </p>
    </div>
  );
}

/** A checked capability line, for the role sections' feature lists. */
export function CapabilityItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-muted">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        className="mt-0.5 size-4 shrink-0 text-primary"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/**
 * A numbered step, for "How it works".
 *
 * The number is the visual anchor rather than an icon — five icons in a row
 * would be five competing shapes saying nothing the sequence doesn't.
 */
export function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-line pt-5">
      <p className="tabular text-sm font-semibold text-primary">{number}</p>
      <h3 className="mt-3 text-base font-semibold text-content">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

/* ── Product visuals ───────────────────────────────────────────────────── */

/**
 * A restrained browser chrome around a product visual.
 *
 * No traffic-light dots pretending to be macOS, no fake URL bar with a made
 * up domain — just enough framing to read as "this is an application", which
 * is the only job it has.
 */
export function BrowserFrame({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Accessible description of what the preview shows. */
  label: string;
  className?: string;
}) {
  return (
    <figure
      className={cx(
        "overflow-hidden rounded-card border border-line bg-surface shadow-raised",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-4 py-2.5">
        <span aria-hidden className="size-2 rounded-full bg-line-strong" />
        <span aria-hidden className="size-2 rounded-full bg-line-strong" />
        <span aria-hidden className="size-2 rounded-full bg-line-strong" />
        <figcaption className="ml-2 truncate text-xs text-subtle">{label}</figcaption>
      </div>
      <div className="overflow-hidden">{children}</div>
    </figure>
  );
}

/**
 * The disclosure that sits under every product visual.
 *
 * Non-negotiable: the previews use representative figures, not a real
 * customer's data, and saying so plainly is the difference between a product
 * demo and an invented statistic.
 */
export function IllustrativeNote({ className }: { className?: string }) {
  return (
    <p className={cx("mt-3 text-xs text-subtle", className)}>
      Product preview. Figures shown are illustrative examples, not customer data.
    </p>
  );
}

/* ── Calls to action ───────────────────────────────────────────────────── */

export function CTABand({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <Band tone="navy">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {title}
        </h2>
        <p className="mt-5 text-pretty text-lg leading-relaxed text-sidebar-text-muted">{lede}</p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">{children}</div>
      </div>
    </Band>
  );
}
