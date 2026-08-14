import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";
import { AppShell } from "@/app/_components/AppShell";

/**
 * Server-side role guard for the entire /instructor tree. This runs before any
 * page renders; the API layer enforces the same boundary independently, so a
 * route guard is never the only thing standing between a role and another's
 * data.
 */
export default async function INSTRUCTORLayout({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "INSTRUCTOR") {
    redirect("/login");
  }

  return (
    <AppShell role="INSTRUCTOR" userName={principal.name}>
      {children}
    </AppShell>
  );
}
