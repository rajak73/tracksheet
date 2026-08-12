"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";

type Day = {
  date: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number | null;
  hasData: boolean;
  openingLogged: boolean;
  closingLogged: boolean;
};
type Activity = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
};

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

/** Drill-down steps 3-5: instructor -> date -> activity. */
export default function AdminInstructorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [name, setName] = useState("");
  const [days, setDays] = useState<Day[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const iRes = await fetch(`/api/instructors/${id}`);
        if (!iRes.ok) return setError(`Could not load instructor (HTTP ${iRes.status})`);
        const inst = (await iRes.json()).instructor;
        setName(inst.user.name);

        const aRes = await fetch(`/api/universities/${inst.universityId}/analytics`);
        if (aRes.ok) {
          const analytics = (await aRes.json()).analytics;
          const mine = analytics.instructors.find(
            (x: { instructorId: string }) => x.instructorId === id,
          );
          if (mine) setDays(mine.days);
        }
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function openDay(date: string) {
    setSelectedDate(date);
    const res = await fetch(`/api/instructors/${id}/activities?from=${date}&to=${date}`);
    if (res.ok) setActivities((await res.json()).activities);
  }

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
        <Link href="/admin/instructors" className="hover:underline">Instructors</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 dark:text-zinc-100">{name}</span>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">{name}</h1>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Days</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">Select a day to see its activity.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
            <thead className="bg-gray-50 dark:bg-zinc-950/40">
              <tr>
                {["Date", "Working", "Capacity", "Productive", "Unutilized", "Open/Close"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-3 text-left text-sm font-semibold text-gray-900 dark:text-zinc-100">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {days.map((d) => (
                <tr
                  key={d.date}
                  className={selectedDate === d.date ? "bg-indigo-50 dark:bg-indigo-950/30" : ""}
                >
                  <td className="px-3 py-3 text-sm font-medium">
                    <button onClick={() => openDay(d.date)} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      {d.date}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                    {d.isWorkingDay ? "Yes" : (d.nonWorkingReason ?? "No")}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{d.capacityHours}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">{d.productiveHours}</td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                    {d.unutilizedHours === null ? (
                      <span className="text-amber-600 dark:text-amber-400">no data</span>
                    ) : (
                      d.unutilizedHours
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-600 dark:text-zinc-400">
                    {d.openingLogged ? "✓" : "—"} / {d.closingLogged ? "✓" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedDate ? (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
            <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">
              Activity on {selectedDate}
            </h2>
          </div>
          {activities.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
              No activity recorded. This is missing data, not zero hours worked.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
              {activities.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-3 sm:px-6">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{a.activityType.label}</p>
                    <p className="text-sm text-gray-500">
                      {hhmm(a.startTime)}–{hhmm(a.endTime)} UTC · {a.status}
                      {a.remarks ? ` · ${a.remarks}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
