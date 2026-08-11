import { redirect } from "next/navigation";
import { getPrincipal } from "@/server/auth/session";

export default async function InstructorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const principal = await getPrincipal();

  if (!principal || principal.role !== "INSTRUCTOR") {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-950 flex flex-col">
      {/* Instructor Navbar */}
      <nav className="bg-sky-700 text-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center space-x-4">
              <span className="font-bold text-xl tracking-tight">My Workday</span>
              <div className="hidden md:flex space-x-4 ml-6">
                <a href="/instructor/dashboard" className="bg-sky-800 rounded-md px-3 py-2 text-sm font-medium">Dashboard</a>
                <a href="#" className="hover:bg-sky-600 rounded-md px-3 py-2 text-sm font-medium">Schedule</a>
                <a href="#" className="hover:bg-sky-600 rounded-md px-3 py-2 text-sm font-medium">Deliverables</a>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium">{principal.name}</span>
              <a href="/login" className="text-sky-200 hover:text-white text-sm font-medium">Sign Out</a>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
