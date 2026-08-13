import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { AppShell } from "@/app/_components/AppShell";
import type { NavItem } from "@/app/_components/RoleNav";

/**
 * Server-side role guard for the entire /admin tree. This runs before any page
 * renders; the API layer enforces the same boundary independently, so a route
 * guard is never the only thing standing between a role and another's data.
 */
const NAV: NavItem[] = [
  { href: "/admin/dashboard", label: "Overview" },
  { href: "/admin/universities", label: "Universities" },
  { href: "/admin/instructors", label: "Instructors" },
  { href: "/admin/reports", label: "Reports" },
];

export default async function ADMINLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "ADMIN") {
    redirect("/login");
  }

  return (
    <AppShell role="Admin" userName={principal.name} nav={NAV}>
      {children}
    </AppShell>
  );
}
