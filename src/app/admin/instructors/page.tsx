"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Instructor = {
  id: string;
  universityId: string;
  employeeCode: string | null;
  user: { name: string; email: string; isActive: boolean };
  university: { name: string; timezone: string };
};

export default function AdminInstructorsPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/instructors");
        if (!res.ok) return setError(`Could not load instructors (HTTP ${res.status})`);
        setInstructors((await res.json()).instructors);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
          Every instructor across all universities.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
            <thead className="bg-gray-50 dark:bg-zinc-950/40">
              <tr>
                {["Instructor", "Email", "ID", "University", "Status"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {instructors.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-3 text-sm font-medium">
                    <Link
                      href={`/admin/instructors/${i.id}`}
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {i.user.name}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500">{i.user.email}</td>
                  <td className="px-3 py-3 text-sm text-gray-500">{i.employeeCode ?? "—"}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.university.name}</td>
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
