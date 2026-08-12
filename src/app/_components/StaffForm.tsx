"use client";

import { useState } from "react";

/**
 * Creates a staff account with an initial password.
 *
 * There is no mail transport in this system, so an emailed invite could not be
 * delivered. The provisioner sets a password and passes it on out-of-band;
 * that is stated in the UI rather than left for someone to discover.
 */
export function StaffForm({
  endpoint,
  roleLabel,
  extraBody,
  onCreated,
}: {
  endpoint: string;
  roleLabel: string;
  extraBody?: Record<string, unknown>;
  onCreated?: () => void;
}) {
  const [form, setForm] = useState({ name: "", email: "", password: "", employeeCode: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);

    if (form.password.length < 12) {
      setError("The initial password must be at least 12 characters.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          employeeCode: form.employeeCode || undefined,
          ...extraBody,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? `Could not create ${roleLabel} (HTTP ${res.status})`);
        return;
      }
      setCreated(form.email);
      setForm({ name: "", email: "", password: "", employeeCode: "" });
      onCreated?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-zinc-400">Name</span>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-zinc-400">Email</span>
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-zinc-400">Initial password</span>
          <input required type="text" minLength={12} value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-gray-600 dark:text-zinc-400">Employee code</span>
          <input value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} className={field} />
        </label>
      </div>

      <p className="text-sm text-gray-500 dark:text-zinc-400">
        The initial password is shown in plain text because you have to pass it on. Ask the {roleLabel} to
        change it after their first sign-in.
      </p>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {created ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          Created {created}. They can sign in now.
        </p>
      ) : null}

      <button type="submit" disabled={saving}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
        {saving ? "Creating…" : `Create ${roleLabel}`}
      </button>
    </form>
  );
}
