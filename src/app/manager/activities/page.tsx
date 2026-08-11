"use client";

import { useEffect, useState } from "react";

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
  instructor: { id: string; employeeCode: string | null; user: { name: string; email: string } };
};

export default function ManagerActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) return setError("Your session has expired.");
        const me = await meRes.json();
        const res = await fetch(`/api/universities/${me.user.universityId}/activities`);
        if (!res.ok) return setError(`Could not load activities (HTTP ${res.status})`);
        setActivities((await res.json()).activities);
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

  const time = (iso: string) => new Date(iso).toISOString().slice(11, 16);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">Activity review</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Recorded activity across your university, including daily opening and closing.
        </p>
      </header>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {activities.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            No activity has been recorded yet. This is missing data, not zero hours worked.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
              <thead className="bg-gray-50 dark:bg-zinc-950/40">
                <tr>
                  {["Date", "Instructor", "Activity", "Time (UTC)", "Status", "Remarks"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {activities.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                      {new Date(a.workDate).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-3 text-sm font-medium text-gray-900 dark:text-zinc-100">
                      {a.instructor.user.name}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{a.activityType.label}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">
                      {time(a.startTime)}–{time(a.endTime)}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-500">{a.status}</td>
                    <td className="px-3 py-3 text-sm text-gray-500">{a.remarks ?? "—"}</td>
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
