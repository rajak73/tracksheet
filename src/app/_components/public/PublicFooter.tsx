import Link from "next/link";
import { Wordmark } from "@/app/_components/public/Wordmark";

/**
 * The public footer.
 *
 * Every link here points at a route that renders. The brief's own rule —
 * "only include links that actually exist" — is why there are no About,
 * Careers, Privacy Policy or Terms of Service columns: those pages have not
 * been built, and a footer full of dead links is worse than a short footer.
 * Add the column when the page exists.
 */

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Platform",
    links: [
      { href: "/platform", label: "Overview" },
      { href: "/ai-intelligence", label: "AI Intelligence" },
      { href: "/analytics", label: "Analytics" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { href: "/solutions/universities", label: "For Universities" },
      { href: "/solutions/managers", label: "For Managers" },
      { href: "/solutions/instructors", label: "For Instructors" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/resources", label: "Resources" },
      { href: "/contact", label: "Contact" },
      { href: "/login", label: "Login" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-5">
          <div className="col-span-2">
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              The academic workforce platform for NIAT — NxtWave&apos;s institute, delivering an
              industry-ready B.Tech with collaborating universities across India.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">
                {column.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="rounded-control text-sm text-muted transition-colors hover:text-content"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 border-t border-line pt-6">
          <p className="text-xs text-subtle">
            © {new Date().getFullYear()} NIAT. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
