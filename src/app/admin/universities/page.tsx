"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type University = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: { dayOfWeek: number; isWorkingDay: boolean; startMinute: number; endMinute: number }[];
  _count: { instructors: number; managers: number };
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default function AdminUniversitiesPage() {
  const [universities, setUniversities] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/universities");
        if (!res.ok) return setError(`Could not load universities (HTTP ${res.status})`);
        setUniversities((await res.json()).universities);
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
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">Universities</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Working hours and daily opening/closing configuration per tenant.
        </p>
      </header>

      <div className="space-y-4">
        {universities.map((u) => (
          <section key={u.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium">
                <Link
                  href={`/admin/universities/${u.id}`}
                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {u.name}
                </Link>
              </h2>
              <span className="text-xs text-gray-400">{u.timezone}</span>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
              {u._count.managers} manager(s) · {u._count.instructors} instructor(s) · opening{" "}
              {u.openingDurationMin} min · closing {u.closingDurationMin} min
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {u.workingHours.map((w) => (
                <span
                  key={w.dayOfWeek}
                  className={`rounded px-2 py-1 text-xs ${
                    w.isWorkingDay
                      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-gray-100 text-gray-500 dark:bg-zinc-800 dark:text-zinc-500"
                  }`}
                >
                  {DAYS[w.dayOfWeek]}
                  {w.isWorkingDay ? ` ${hhmm(w.startMinute)}–${hhmm(w.endMinute)}` : " closed"}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Creating universities and assigning managers is not yet available in the UI. Configuration
        can be changed via <code>PATCH /api/universities/:id/config</code>.
      </p>
    </div>
  );
}
