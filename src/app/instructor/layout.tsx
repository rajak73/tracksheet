import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { InstructorShell } from "@/app/_components/InstructorShell";
import { TimeZoneProvider } from "@/app/_lib/zone";

/**
 * Server-side role guard for the entire /instructor tree. This runs before any
 * page renders; the API layer enforces the same boundary independently, so a
 * route guard is never the only thing standing between a role and another's
 * data.
 *
 * The instructor deliberately does NOT get `AppShell`'s sidebar. Admin and
 * manager navigate between many destinations; an instructor works on one page,
 * and a permanent nav listing pages they do not need would take the horizontal
 * room the week grid actually uses. See `InstructorShell`.
 */
export default async function INSTRUCTORLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "INSTRUCTOR") {
    redirect("/login");
  }

  /* Resolved here, once, because this component already holds the principal —
   * so every screen below can say what day it is where the WORK happens
   * without a request of its own. See `TimeZoneProvider`. */
  const university = principal.universityId
    ? await prisma.university.findUnique({
        where: { id: principal.universityId },
        select: { timezone: true },
      })
    : null;

  return (
    <TimeZoneProvider timeZone={university?.timezone ?? null}>
      <InstructorShell userName={principal.name}>
        {children}
      </InstructorShell>
    </TimeZoneProvider>
  );
}
