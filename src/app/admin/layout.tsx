import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { AppShell } from "@/app/_components/AppShell";

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

  return (
    <AppShell role="ADMIN" userName={principal.name}>
      {children}
    </AppShell>
  );
}
