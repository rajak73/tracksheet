"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { StaffForm } from "@/app/_components/StaffForm";

type Manager = {
  id: string;
  employeeCode: string | null;
  isPrimary: boolean;
  instructorCount: number;
  user: { name: string; email: string; isActive: boolean };
};
type InstructorRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
};

/** Drill-down step 2: university -> managers + instructors. */
export default function AdminUniversityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [name, setName] = useState<string>("");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [instructors, setInstructors] = useState<InstructorRow[]>([]);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [mRes, aRes] = await Promise.all([
          fetch(`/api/universities/${id}/managers`),
          fetch(`/api/universities/${id}/analytics`),
        ]);
        if (!mRes.ok) return setError(`Could not load managers (HTTP ${mRes.status})`);
        const m = await mRes.json();
        setManagers(m.managers);
        setName(m.universityName ?? "");
        if (aRes.ok) {
          const a = (await aRes.json()).analytics;
          setInstructors(a.instructors);
          setPeriod({ from: a.from, to: a.to });
        }
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />;
  if (error)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );

  return (
    <div className="space-y-6">
      <nav className="text-sm text-gray-500 dark:text-zinc-400">
        <Link href="/admin/universities" className="hover:underline">Universities</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 dark:text-zinc-100">{name}</span>
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">{name}</h1>
        {period ? (
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">{period.from} to {period.to}</p>
        ) : null}
      </header>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Managers</h2>
        </div>
        {managers.length === 0 ? (
          <div className="px-4 py-5 sm:px-6">
            <p className="text-sm text-gray-500 dark:text-zinc-400">
              No manager assigned. The first manager created becomes the primary manager.
            </p>
            <StaffForm
              endpoint={`/api/universities/${id}/managers`}
              roleLabel="manager"
              onCreated={() => window.location.reload()}
            />
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
            {managers.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-4 py-4 sm:px-6">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {m.user.name}
                    {m.isPrimary ? (
                      <span className="ml-2 rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                        primary
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-gray-500">{m.user.email}</p>
                </div>
                <span className="text-sm text-gray-600 dark:text-zinc-400">
                  {m.instructorCount} instructor(s)
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Instructors</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Select one to drill into their days.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
            <thead className="bg-gray-50 dark:bg-zinc-950/40">
              <tr>
                {["Instructor", "Capacity", "Productive", "Unutilized", "Missing", "Utilization"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {instructors.map((i) => (
                <tr key={i.instructorId}>
                  <td className="px-3 py-3 text-sm font-medium">
                    <Link
                      href={`/admin/instructors/${i.instructorId}`}
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {i.instructorName}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.capacityHours}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.productiveHours}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.unutilizedHours}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.missingDataHours}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                    {i.utilizationPct === null ? "—" : `${i.utilizationPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
