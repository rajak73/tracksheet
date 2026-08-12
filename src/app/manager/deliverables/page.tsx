"use client";

import { useCallback, useEffect, useState } from "react";

type Instructor = { id: string; user: { name: string } };
type Deliverable = {
  id: string;
  title: string;
  category: string | null;
  targetQuantity: number;
  targetHours: number;
  dueDate: string;
  status: string;
  logs: { quantityCompleted: number; hoursSpent: number }[];
};

export default function ManagerDeliverablesPage() {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [byInstructor, setByInstructor] = useState<Record<string, Deliverable[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    instructorId: "", title: "", category: "", targetQuantity: 1, targetHours: 1, dueDate: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/instructors");
    if (!res.ok) {
      setError(`Could not load instructors (HTTP ${res.status})`);
      return;
    }
    const list = (await res.json()).instructors as Instructor[];
    setInstructors(list);
    setForm((f) => ({ ...f, instructorId: f.instructorId || (list[0]?.id ?? "") }));

    const entries = await Promise.all(
      list.map(async (i) => {
        const r = await fetch(`/api/instructors/${i.id}/deliverables`);
        return [i.id, r.ok ? (await r.json()).deliverables : []] as const;
      }),
    );
    setByInstructor(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().finally(() => setLoading(false));
  }, [load]);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.instructorId || !form.title || !form.dueDate) {
      setFormError("Instructor, title and due date are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/instructors/${form.instructorId}/deliverables`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          category: form.category || undefined,
          targetQuantity: Number(form.targetQuantity),
          targetHours: Number(form.targetHours),
          dueDate: form.dueDate,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(body?.error?.message ?? `Could not assign (HTTP ${res.status})`);
        return;
      }
      setForm((f) => ({ ...f, title: "", category: "" }));
      await load();
    } finally {
      setSaving(false);
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
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">Deliverables</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-zinc-400">
          Assign work and track progress against target.
        </p>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Assign a deliverable</h2>
        <form onSubmit={assign} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Instructor</span>
            <select value={form.instructorId} onChange={(e) => setForm({ ...form, instructorId: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {instructors.map((i) => <option key={i.id} value={i.id}>{i.user.name}</option>)}
            </select>
          </label>
          <label className="text-sm lg:col-span-2">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Quantity</span>
            <input type="number" min={1} value={form.targetQuantity}
              onChange={(e) => setForm({ ...form, targetQuantity: Number(e.target.value) })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Hours</span>
            <input type="number" min={0.5} step={0.5} value={form.targetHours}
              onChange={(e) => setForm({ ...form, targetHours: Number(e.target.value) })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-zinc-400">Due</span>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
          </label>
          <div className="flex items-end lg:col-span-6">
            <button type="submit" disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-60">
              {saving ? "Assigning…" : "Assign"}
            </button>
          </div>
        </form>
        {formError ? (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {formError}
          </p>
        ) : null}
      </section>

      {instructors.map((i) => {
        const items = byInstructor[i.id] ?? [];
        return (
          <section key={i.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="border-b border-gray-200 px-4 py-4 sm:px-6 dark:border-zinc-800">
              <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">{i.user.name}</h2>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-500 dark:text-zinc-400">No deliverables assigned.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
                {items.map((d) => {
                  const done = d.logs.reduce((a, l) => a + l.quantityCompleted, 0);
                  const hours = d.logs.reduce((a, l) => a + l.hoursSpent, 0);
                  const pct = d.targetQuantity > 0 ? Math.round((done / d.targetQuantity) * 100) : 0;
                  return (
                    <li key={d.id} className="px-4 py-3 sm:px-6">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{d.title}</p>
                        <p className="text-sm text-gray-500">
                          {done}/{d.targetQuantity} · {hours}/{d.targetHours} hrs · due{" "}
                          {new Date(d.dueDate).toISOString().slice(0, 10)}
                        </p>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-gray-100 dark:bg-zinc-800">
                        <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
