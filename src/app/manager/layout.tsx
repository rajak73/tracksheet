import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { AppShell } from "@/app/_components/AppShell";
import { TimeZoneProvider } from "@/app/_lib/zone";

/**
 * Server-side role guard for the entire /manager tree. This runs before any page
 * renders; the API layer enforces the same boundary independently, so a route
 * guard is never the only thing standing between a role and another's data.
 */
export default async function MANAGERLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "MANAGER") {
    redirect("/login");
  }

  /* A manager reads their instructors' days, so the boundary that matters is
   * the UNIVERSITY's — not the city the manager happens to be sitting in. */
  const university = principal.universityId
    ? await prisma.university.findUnique({
        where: { id: principal.universityId },
        select: { timezone: true },
      })
    : null;

  return (
    <TimeZoneProvider timeZone={university?.timezone ?? null}>
    <AppShell role="MANAGER" userName={principal.name}>
      {children}
    </AppShell>
    </TimeZoneProvider>
  );
}
