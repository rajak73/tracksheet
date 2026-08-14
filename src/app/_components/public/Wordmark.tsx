import Link from "next/link";

/**
 * The NEXTWAVE wordmark.
 *
 * Matches the authenticated product exactly — the same serif `font-display`
 * face and the same small primary-coloured mark used on the sign-in screen —
 * so the brand does not change shape when someone crosses from the public
 * site into the app.
 *
 * The mark is a rising three-step wave: the product's whole proposition is
 * turning activity into a trend you can act on, and three ascending bars say
 * that without an illustration.
 */
export function Wordmark({
  onNavy = false,
  href = "/",
}: {
  onNavy?: boolean;
  /** Rendered as plain markup rather than a link when `null`. */
  href?: string | null;
}) {
  const inner = (
    <span className="inline-flex items-center gap-2.5">
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={onNavy ? "size-5 text-white" : "size-5 text-primary"}
        fill="none"
      >
        <rect x="1" y="12" width="4.5" height="7" rx="1" fill="currentColor" opacity="0.5" />
        <rect x="7.75" y="7" width="4.5" height="12" rx="1" fill="currentColor" opacity="0.75" />
        <rect x="14.5" y="1" width="4.5" height="18" rx="1" fill="currentColor" />
      </svg>
      <span
        className={`font-display text-base font-semibold tracking-tight ${
          onNavy ? "text-white" : "text-content"
        }`}
      >
        NEXTWAVE
      </span>
    </span>
  );

  if (href === null) return inner;

  return (
    <Link href={href} className="rounded-control" aria-label="NEXTWAVE — home">
      {inner}
    </Link>
  );
}
