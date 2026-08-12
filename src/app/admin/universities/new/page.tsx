"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Common zones first; any IANA name is accepted by the backend. */
const TIMEZONES = [
  "Asia/Kolkata", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Australia/Sydney", "Asia/Singapore", "UTC",
];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export default function NewUniversityPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", code: "", slug: "", timezone: "Asia/Kolkata",
    openingDurationMin: 15, closingDurationMin: 15, breakDurationMin: 60,
    start: "09:00", end: "18:00",
    country: "", contactEmail: "",
  });
  const [workingDays, setWorkingDays] = useState<boolean[]>([false, true, true, true, true, true, false]);
  const [holidays, setHolidays] = useState<Array<{ date: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (toMinutes(form.end) <= toMinutes(form.start)) {
      setError("The working day must end after it starts.");
      return;
    }
    if (!workingDays.some(Boolean)) {
      setError("Select at least one working day.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/universities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code.toUpperCase(),
          slug: form.slug.toLowerCase(),
          timezone: form.timezone,
          openingDurationMin: Number(form.openingDurationMin),
          closingDurationMin: Number(form.closingDurationMin),
          breakDurationMin: Number(form.breakDurationMin),
          country: form.country || undefined,
          contactEmail: form.contactEmail || undefined,
          workingHours: DAYS.map((_, dayOfWeek) => ({
            dayOfWeek,
            isWorkingDay: workingDays[dayOfWeek],
            // Non-working days still need a well-formed window for the
            // database CHECK; isWorkingDay is what actually counts.
            startMinute: workingDays[dayOfWeek] ? toMinutes(form.start) : 0,
            endMinute: workingDays[dayOfWeek] ? toMinutes(form.end) : 1,
          })),
          holidays: holidays.filter((h) => h.date && h.name),
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Surface the server's own reason — "code already exists" is useful,
        // "failed" is not.
        setError(body?.error?.message ?? `Could not create university (HTTP ${res.status})`);
        return;
      }
      router.push(`/admin/universities/${body.university.id}`);
    } finally {
      setSaving(false);
    }
  }

  const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div className="space-y-6">
      <nav className="text-sm text-gray-500 dark:text-zinc-400">
        <Link href="/admin/universities" className="hover:underline">Universities</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 dark:text-zinc-100">New</span>
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">
          Create a university
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Working hours drive every opening/closing window and capacity figure, so they are set here
          rather than defaulted.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-6">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Identity</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm lg:col-span-2">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Name</span>
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Code</span>
              <input required placeholder="UNIV003" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Slug</span>
              <input required placeholder="northfield" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Country</span>
              <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} className={field} />
            </label>
            <label className="text-sm lg:col-span-2">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Contact email</span>
              <input type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} className={field} />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Working hours</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Timezone</span>
              <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={field}>
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Day starts</span>
              <input type="time" required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Day ends</span>
              <input type="time" required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Break (min)</span>
              <input type="number" min={0} value={form.breakDurationMin} onChange={(e) => setForm({ ...form, breakDurationMin: Number(e.target.value) })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Opening (min)</span>
              <input type="number" min={1} value={form.openingDurationMin} onChange={(e) => setForm({ ...form, openingDurationMin: Number(e.target.value) })} className={field} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600 dark:text-zinc-400">Closing (min)</span>
              <input type="number" min={1} value={form.closingDurationMin} onChange={(e) => setForm({ ...form, closingDurationMin: Number(e.target.value) })} className={field} />
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-sm text-gray-600 dark:text-zinc-400">Working days</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DAYS.map((day, i) => (
                <label key={day} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${
                  workingDays[i]
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
                    : "border-gray-300 text-gray-500 dark:border-zinc-700 dark:text-zinc-500"
                }`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={workingDays[i]}
                    onChange={() => setWorkingDays(workingDays.map((v, j) => (j === i ? !v : v)))}
                  />
                  {day.slice(0, 3)}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Initial holidays</h2>
            <button
              type="button"
              onClick={() => setHolidays([...holidays, { date: "", name: "" }])}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm dark:border-zinc-700"
            >
              Add holiday
            </button>
          </div>
          {holidays.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500 dark:text-zinc-400">
              Optional — holidays can also be added later from the university&apos;s configuration.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {holidays.map((h, i) => (
                <div key={i} className="flex gap-3">
                  <input type="date" value={h.date}
                    onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
                    className={field} />
                  <input placeholder="Name" value={h.name}
                    onChange={(e) => setHolidays(holidays.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    className={field} />
                  <button type="button" onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}
                    className="rounded-lg border border-gray-300 px-3 text-sm dark:border-zinc-700">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={saving}
          className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
          {saving ? "Creating…" : "Create university"}
        </button>
      </form>
    </div>
  );
}
