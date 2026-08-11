"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type InstructorRow = {
  instructorId: string;
  instructorName: string;
  employeeCode: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  overlapHours: number;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
  hoursByActivityType: Record<string, number>;
};

type Analytics = {
  from: string;
  to: string;
  totals: {
    instructors: number;
    capacityHours: number;
    productiveHours: number;
    unutilizedHours: number;
    missingDataHours: number;
    utilizationPct: number | null;
    openingCompliancePct: number | null;
    closingCompliancePct: number | null;
    hoursByActivityType: Record<string, number>;
  };
  instructors: InstructorRow[];
};

type AiInsight = {
  id: string;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  period: string;
  recommendation: string;
  status: string;
};

type Notification = { id: string; title: string; body: string | null };

const SEVERITY_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-amber-400",
  LOW: "bg-sky-400",
};

function Metric({ label, value, suffix }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <dt className="truncate text-sm font-medium text-gray-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-gray-900 dark:text-zinc-100">
        {value === null ? (
          <span className="text-base font-normal text-gray-400">Not measurable</span>
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

export default function ManagerDashboardPage() {
  const [universityId, setUniversityId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        setError("Your session has expired.");
        return;
      }
      const me = await meRes.json();
      const uid = me.user.universityId as string;
      setUniversityId(uid);

      const [aRes, iRes, nRes] = await Promise.all([
        fetch(`/api/universities/${uid}/analytics`),
        fetch(`/api/universities/${uid}/insights`),
        fetch(`/api/notifications`),
      ]);

      if (aRes.ok) setAnalytics((await aRes.json()).analytics);
      else setError(`Could not load analytics (HTTP ${aRes.status})`);

      if (iRes.ok) setInsights((await iRes.json()).insights);
      if (nRes.ok) setNotifications((await nRes.json()).notifications);
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch. `load` only calls setState after awaiting the network,
    // so no state is set synchronously during the effect; the rule cannot see
    // through the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function generateInsights() {
    if (!universityId) return;
    setGenerating(true);
    try {
      await fetch(`/api/universities/${universityId}/insights`, { method: "POST" });
      const res = await fetch(`/api/universities/${universityId}/insights`);
      if (res.ok) setInsights((await res.json()).insights);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-200 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
        <h2 className="font-semibold text-red-800 dark:text-red-300">Unable to load dashboard</h2>
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const t = analytics.totals;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
            University Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
            {analytics.from} to {analytics.to}
          </p>
        </div>
        <Link
          href="/manager/reports"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          View reports
        </Link>
      </header>

      {notifications.length > 0 ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          {notifications.length} unread notification{notifications.length === 1 ? "" : "s"} —{" "}
          {notifications[0].title}
        </div>
      ) : null}

      <dl className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Metric label="Instructors" value={t.instructors} />
        <Metric label="Capacity" value={t.capacityHours} suffix="hrs" />
        <Metric label="Productive" value={t.productiveHours} suffix="hrs" />
        <Metric label="Utilization" value={t.utilizationPct} suffix="%" />
        <Metric label="Unutilized" value={t.unutilizedHours} suffix="hrs" />
        <Metric label="Missing data" value={t.missingDataHours} suffix="hrs" />
        <Metric label="Opening compliance" value={t.openingCompliancePct} suffix="%" />
        <Metric label="Closing compliance" value={t.closingCompliancePct} suffix="%" />
      </dl>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">
            Instructor workload
          </h2>
        </div>
        {analytics.instructors.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            No active instructors in this university.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
              <thead className="bg-gray-50 dark:bg-zinc-950/40">
                <tr>
                  {[
                    "Instructor",
                    "Capacity",
                    "Productive",
                    "Unutilized",
                    "Missing",
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
                {analytics.instructors.map((i) => (
                  <tr key={i.instructorId}>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-zinc-100">
                      {i.instructorName}
                      {i.employeeCode ? (
                        <span className="ml-2 text-xs text-gray-400">{i.employeeCode}</span>
                      ) : null}
                      {i.overlapHours > 0 ? (
                        <span
                          className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          title="Logged activities overlap; merged time is reported"
                        >
                          overlap
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.capacityHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.productiveHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{i.unutilizedHours}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {i.missingDataHours > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">{i.missingDataHours}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {i.utilizationPct === null ? "—" : `${i.utilizationPct}%`}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {i.openingCompliancePct === null ? "—" : `${i.openingCompliancePct}%`}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {i.closingCompliancePct === null ? "—" : `${i.closingCompliancePct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">AI insights</h2>
          <button
            onClick={generateInsights}
            disabled={generating}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
        {insights.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            No insights yet. Insights are derived from recorded activity — if nothing has been
            logged for this period, none will be generated.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
            {insights.map((insight) => (
              <li key={insight.id} className="flex gap-3 px-4 py-4 sm:px-6">
                <span
                  className={`mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                    SEVERITY_DOT[insight.severity] ?? "bg-gray-400"
                  }`}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {insight.type.replaceAll("_", " ")}
                    <span className="ml-2 text-xs font-normal text-gray-400">{insight.period}</span>
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-zinc-400">
                    {insight.recommendation}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
