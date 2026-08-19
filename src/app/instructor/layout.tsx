import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { InstructorShell } from "@/app/_components/InstructorShell";

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

  return (
    <InstructorShell userName={principal.name}>
      {children}
    </InstructorShell>
  );
}
