import type { ReactNode } from "react";
import { RoleNav, type NavItem } from "@/app/_components/RoleNav";
import { SignOutButton } from "@/app/_components/SignOutButton";

/**
 * The chrome every signed-in page sits inside.
 *
 * One shell for all three roles, rather than three differently-coloured ones.
 * The earlier design gave admin/manager/instructor their own header colour,
 * which read as three products sharing a login. Orientation now comes from a
 * small role badge — the way an environment indicator works in Stripe or
 * Vercel — while the layout, spacing and navigation stay identical.
 */
export function AppShell({
  role,
  userName,
  nav,
  children,
}: {
  role: string;
  userName: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-sm font-semibold tracking-tight text-content">
                Tracksheet
              </span>
              <span className="hidden rounded-md bg-sunken px-2 py-0.5 text-xs font-medium text-muted sm:inline">
                {role}
              </span>
              <div className="hidden md:block">
                <RoleNav items={nav} />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-sm text-muted sm:inline">{userName}</span>
              <SignOutButton />
            </div>
          </div>

          {/* Navigation wraps below the bar on small screens rather than
              collapsing into a menu — there are at most five destinations. */}
          <div className="-mx-1 pb-2 md:hidden">
            <RoleNav items={nav} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children}
      </main>
    </div>
  );
}
