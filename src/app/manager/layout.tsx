import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { RoleNav, type NavItem } from "@/app/_components/RoleNav";
import { SignOutButton } from "@/app/_components/SignOutButton";

/**
 * Server-side role guard for the entire /manager tree. This runs before any page
 * renders; the API layer enforces the same boundary independently, so a route
 * guard is never the only thing standing between a role and another's data.
 */
const NAV: NavItem[] = [
  { href: "/manager/dashboard", label: "Dashboard" },
  { href: "/manager/instructors", label: "Instructors" },
  { href: "/manager/activities", label: "Activities" },
  { href: "/manager/reports", label: "Reports" },
];

export default async function MANAGERLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "MANAGER") {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-zinc-950">
      <header className="bg-emerald-700 text-white shadow-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <span className="text-xl font-bold tracking-tight">University Operations</span>
              <div className="hidden md:block">
                <RoleNav items={NAV} />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden text-sm font-medium sm:inline">{principal.name}</span>
              <SignOutButton />
            </div>
          </div>
          <div className="pb-2 md:hidden">
            <RoleNav items={NAV} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
