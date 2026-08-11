"use client";

import { useEffect, useState } from "react";

type Row = {
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
};
type University = { id: string; name: string };

export default function AdminReportsPage() {
  const [universities, setUniversities] = useState<University[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [report, setReport] = useState<{ from: string; to: string; rows: Row[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/universities");
        if (!res.ok) return setError(`Could not load universities (HTTP ${res.status})`);
        const list = (await res.json()).universities as University[];
        setUniversities(list);
        if (list[0]) setSelected(list[0].id);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    (async () => {
      const res = await fetch(`/api/universities/${selected}/reports`);
      if (res.ok) setReport((await res.json()).report);
    })();
  }, [selected]);

  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />;
  if (error)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">Reports</h1>
          {report ? (
            <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
              {report.from} to {report.to}
            </p>
          ) : null}
        </div>
        <div className="flex items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">University</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          {selected && report ? (
            <a
              href={`/api/universities/${selected}/reports?from=${report.from}&to=${report.to}&export=csv`}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Export CSV
            </a>
          ) : null}
        </div>
      </header>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {!report || report.rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">Nothing to report for this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
              <thead className="bg-gray-50 dark:bg-zinc-950/40">
                <tr>
                  {["Instructor", "ID", "Capacity", "Productive", "Unutilized", "Missing", "Utilization"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {report.rows.map((r) => (
                  <tr key={r.instructorName + (r.employeeCode ?? "")}>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-zinc-100">{r.instructorName}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">{r.employeeCode ?? "—"}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{r.capacityHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{r.productiveHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{r.unutilizedHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{r.missingDataHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {r.utilizationPct === null ? "—" : `${r.utilizationPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
