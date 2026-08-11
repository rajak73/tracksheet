"use client";

import { useEffect, useState } from "react";

type ReportRow = {
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type Report = { from: string; to: string; rows: ReportRow[] };

export default function ManagerReportsPage() {
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) return setError("Your session has expired.");
        const me = await meRes.json();
        const uid = me.user.universityId as string;
        setUniversityId(uid);

        const res = await fetch(`/api/universities/${uid}/reports`);
        if (!res.ok) return setError(`Could not load the report (HTTP ${res.status})`);
        setReport((await res.json()).report);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />;
  }

  if (error || !report) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <h2 className="font-semibold text-red-800 dark:text-red-300">Unable to load report</h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
            Workload report
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
            {report.from} to {report.to} — the same figures shown on the dashboard
          </p>
        </div>
        {universityId ? (
          <a
            href={`/api/universities/${universityId}/reports?from=${report.from}&to=${report.to}&export=csv`}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Export CSV
          </a>
        ) : null}
      </header>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {report.rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            No instructors to report on for this period.
          </p>
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
                {report.rows.map((row) => (
                  <tr key={row.instructorName + (row.employeeCode ?? "")}>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-zinc-100">{row.instructorName}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">{row.employeeCode ?? "—"}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{row.capacityHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{row.productiveHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{row.unutilizedHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{row.missingDataHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {row.utilizationPct === null ? "—" : `${row.utilizationPct}%`}
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
