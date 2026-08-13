import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { AppShell } from "@/app/_components/AppShell";
import type { NavItem } from "@/app/_components/RoleNav";

/**
 * Server-side role guard for the entire /manager tree. This runs before any page
 * renders; the API layer enforces the same boundary independently, so a route
 * guard is never the only thing standing between a role and another's data.
 */
const NAV: NavItem[] = [
  { href: "/manager/dashboard", label: "Overview" },
  { href: "/manager/instructors", label: "Instructors" },
  { href: "/manager/activities", label: "Activities" },
  { href: "/manager/deliverables", label: "Deliverables" },
  { href: "/manager/reports", label: "Reports" },
];

export default async function MANAGERLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "MANAGER") {
    redirect("/login");
  }

  return (
    <AppShell role="Manager" userName={principal.name} nav={NAV}>
      {children}
    </AppShell>
  );
}
