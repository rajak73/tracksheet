"use client";

import { useCallback, useEffect, useState } from "react";

type ActivityType = {
  id: string;
  code: string;
  label: string;
  isOncePerDay: boolean;
  isDerivedFromWorkingHours: boolean;
};

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
};

const time = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export default function InstructorActivitiesPage() {
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ code: "", date: "", start: "09:00", end: "10:00", remarks: "" });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async (id?: string) => {
    const target = id ?? instructorId;
    if (!target) return;
    const res = await fetch(`/api/instructors/${target}/activities`);
    if (res.ok) setActivities((await res.json()).activities);
  }, [instructorId]);

  useEffect(() => {
    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) {
          setError("Your session has expired.");
          return;
        }
        const me = await meRes.json();
        const iid = me.user.instructorId as string | null;
        if (!iid) {
          setError("No instructor profile is linked to this account.");
          return;
        }
        setInstructorId(iid);

        const tRes = await fetch("/api/activity-types");
        if (tRes.ok) {
          const list = (await tRes.json()).activityTypes as ActivityType[];
          // Opening and closing are recorded from the dashboard against the
          // university's configured window, so they are not free-form options
          // here — that is what keeps them once-per-day rather than ad hoc.
          const selectable = list.filter((t) => !t.isDerivedFromWorkingHours);
          setTypes(selectable);
          setForm((f) => ({ ...f, code: selectable[0]?.code ?? "" }));
        }

        await load(iid);
      } catch {
        setError("Could not reach the server");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!instructorId) return;
    setFormError(null);
    setSuccess(null);

    if (!form.date) {
      setFormError("Pick a date.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/instructors/${instructorId}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityTypeCode: form.code,
          startTime: new Date(`${form.date}T${form.start}:00`).toISOString(),
          endTime: new Date(`${form.date}T${form.end}:00`).toISOString(),
          remarks: form.remarks || undefined,
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Surface the server's actual reason rather than a generic failure —
        // "endTime must be after startTime" is useful, "error" is not.
        setFormError(body?.error?.message ?? `Could not record activity (HTTP ${res.status})`);
        return;
      }

      setSuccess("Activity recorded.");
      setForm((f) => ({ ...f, remarks: "" }));
      await load();
    } finally {
      setSubmitting(false);
    }
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
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">My activities</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Record teaching, learning, support, and other work. Only your own records are visible here.
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Record an activity</h2>
        <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Activity</span>
            <select
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {types.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Date</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Start</span>
            <input
              type="time"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">End</span>
            <input
              type="time"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="text-sm sm:col-span-2 lg:col-span-4">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Remarks (optional)</span>
            <input
              type="text"
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Record"}
            </button>
          </div>
        </form>

        {formError ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {formError}
          </p>
        ) : null}
        {success ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {success}
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-gray-200 px-4 py-5 sm:px-6 dark:border-zinc-800">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Recorded activity</h2>
        </div>
        {activities.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 dark:text-zinc-400">
            Nothing recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-zinc-800">
              <thead className="bg-gray-50 dark:bg-zinc-950/40">
                <tr>
                  {["Date", "Activity", "Time (UTC)", "Status", "Remarks"].map((h) => (
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
                      {a.activityType.label}
                    </td>
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
      </section>
    </div>
  );
}
