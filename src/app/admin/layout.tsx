import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { AppShell } from "@/app/_components/AppShell";
import { TimeZoneProvider } from "@/app/_lib/zone";

/**
 * Server-side role guard for the entire /admin tree. This runs before any page
 * renders; the API layer enforces the same boundary independently, so a route
 * guard is never the only thing standing between a role and another's data.
 *
 * The shell takes only the role — the navigation for it is defined once in
 * nav.tsx rather than being passed in from here, so three layouts cannot end
 * up with three slightly different menus.
 */
export default async function ADMINLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "ADMIN") {
    redirect("/login");
  }

  /* ── An admin has no university, and so no "today" of their own ────────
   * Stated as `null` rather than left absent, because the two look identical
   * from a screen and mean different things: absent is somebody forgetting to
   * provide it, null is this role genuinely spanning several zones at once.
   *
   * Screens under here that look at ONE university wrap their own subtree in
   * that university's zone — see the tracker and manager detail pages — so the
   * fallback below is only ever reached where the question really has no single
   * answer. */
  return (
    <TimeZoneProvider timeZone={null}>
    <AppShell role="ADMIN" userName={principal.name}>
      {children}
    </AppShell>
    </TimeZoneProvider>
  );
}
