import type { ReactNode } from "react";
import { PublicNavbar } from "@/app/_components/public/PublicNavbar";
import { PublicFooter } from "@/app/_components/public/PublicFooter";

/**
 * Chrome for every public marketing page.
 *
 * A route group, so these pages sit at `/`, `/platform`, `/security` … with
 * no URL segment of their own. `/login` deliberately stays OUTSIDE this
 * group: the sign-in screen should not carry marketing navigation, and the
 * authenticated product has its own shell entirely.
 *
 * Nothing here touches auth — the public site is genuinely public, and the
 * role guards continue to live in the /admin, /manager and /instructor
 * layouts where they always have.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a
        href="#main"
        className="sr-only-text focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <PublicNavbar />
      <main id="main" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
