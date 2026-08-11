"use client";

import { useEffect, useState } from "react";

type UniversityRow = {
  universityId: string;
  name: string;
  timezone: string;
  from: string;
  to: string;
  instructors: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
};

type Overview = {
  totalUniversities: number;
  totalManagers: number;
  totalInstructors: number;
  openInsights: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  teachingHours: number;
  learningHours: number;
};

/** `null` means "not measurable", which is not the same as zero. */
function Metric({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="truncate text-sm font-medium text-gray-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900 dark:text-zinc-100">
        {value === null ? (
          <span className="text-base font-normal text-gray-400 dark:text-zinc-500">
            Not measurable
          </span>
        ) : (
          <>
            {value}
            {suffix ? <span className="ml-1 text-base font-normal text-gray-500">{suffix}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [universities, setUniversities] = useState<UniversityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/overview");
        if (!res.ok) {
          setError(`Could not load platform metrics (HTTP ${res.status})`);
          return;
        }
        const data = await res.json();
        setOverview(data.overview);
        setUniversities(data.universities);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-72 animate-pulse rounded bg-gray-200 dark:bg-zinc-800" />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <h2 className="font-semibold text-red-800 dark:text-red-300">Unable to load metrics</h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const period = universities[0];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
          Global Command Center
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Platform-wide metrics across all universities
          {period ? ` · ${period.from} to ${period.to}` : null}
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Metric label="Universities" value={overview.totalUniversities} />
        <Metric label="Managers" value={overview.totalManagers} />
        <Metric label="Active Instructors" value={overview.totalInstructors} />
        <Metric label="Open AI Insights" value={overview.openInsights} />
        <Metric label="Capacity" value={overview.capacityHours} suffix="hrs" />
        <Metric label="Teaching" value={overview.teachingHours} suffix="hrs" />
        <Metric label="Learning" value={overview.learningHours} suffix="hrs" />
        <Metric label="Unutilized" value={overview.unutilizedHours} suffix="hrs" />
        <Metric label="Productive" value={overview.productiveHours} suffix="hrs" />
        <Metric label="Utilization" value={overview.utilizationPct} suffix="%" />
      </dl>

      {overview.missingDataHours > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          {overview.missingDataHours} hours of expected working time have no activity records.
          These are reported as missing data, not as unutilized time.
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">
            University comparison
          </h2>
        </div>

        {universities.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            No universities have been created yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
              <thead className="bg-gray-50 dark:bg-zinc-950/40">
                <tr>
                  {[
                    "University",
                    "Instructors",
                    "Capacity",
                    "Productive",
                    "Unutilized",
                    "Utilization",
                    "Opening",
                    "Closing",
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {universities.map((u) => (
                  <tr key={u.universityId}>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-zinc-100">
                      {u.name}
                      <span className="ml-2 text-xs text-gray-400">{u.timezone}</span>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{u.instructors}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{u.capacityHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{u.productiveHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{u.unutilizedHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {u.utilizationPct === null ? "—" : `${u.utilizationPct}%`}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {u.openingCompliancePct === null ? "—" : `${u.openingCompliancePct}%`}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {u.closingCompliancePct === null ? "—" : `${u.closingCompliancePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
