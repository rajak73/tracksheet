"use client";

import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";

/**
 * Creates a staff account with an initial password.
 *
 * ONE definition, used for both instructors and managers (§27) — the two
 * differ only in `endpoint`, `roleLabel` and any `extraBody`, never in shape.
 *
 * There is no mail transport in this system, so an emailed invite could not be
 * delivered. The provisioner sets a password and passes it on out-of-band;
 * that is stated in the form rather than left for someone to discover.
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
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", employeeCode: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

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
      toast("success", `${form.name} can sign in now.`);
      setForm({ name: "", email: "", password: "", employeeCode: "" });
      onCreated?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name" required>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Email" required>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Initial password" hint="At least 12 characters." required>
          <input
            required
            type="text"
            minLength={12}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Employee code" hint="Optional.">
          <input
            value={form.employeeCode}
            onChange={(e) => setForm({ ...form, employeeCode: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      <p className="text-sm text-muted">
        The initial password is shown in plain text because you have to pass it on. Ask the{" "}
        {roleLabel} to change it after their first sign-in.
      </p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Button type="submit" disabled={saving}>
        {saving ? "Creating…" : `Create ${roleLabel}`}
      </Button>
    </form>
  );
}
