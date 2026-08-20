/**
 * Buttons, and the one link that has to look like one.
 *
 * Part of the shared UI primitives — see `ui/index.ts`.
 */

import { cx } from "@/app/_components/ui/cx";
import Link from "next/link";

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
