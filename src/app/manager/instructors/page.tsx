"use client";

import { useCallback, useEffect, useState } from "react";
import { StaffForm } from "@/app/_components/StaffForm";

type Instructor = {
  id: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
};

export default function ManagerInstructorsPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/instructors");
      if (!res.ok) return setError(`Could not load instructors (HTTP ${res.status})`);
      setInstructors((await res.json()).instructors);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />;
  if (error)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">Instructors</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Instructors in your university. The list is scoped by the server to your tenant.
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Add an instructor</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
          New instructors join your university automatically — the tenant comes from your session,
          never from this form.
        </p>
        <StaffForm endpoint="/api/instructors" roleLabel="instructor" onCreated={load} />
      </section>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
            <thead className="bg-gray-50 dark:bg-zinc-950/40">
              <tr>
                {["Instructor", "Email", "ID", "Status"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {instructors.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-zinc-100">{i.user.name}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{i.user.email}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{i.employeeCode ?? "—"}</td>
                  <td className="px-3 py-3 text-sm">
                    <span className={i.user.isActive ? "text-emerald-600" : "text-gray-400"}>
                      {i.user.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
