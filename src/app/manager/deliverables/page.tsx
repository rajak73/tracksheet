"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState,
  Field, PageHeader, Skeleton, inputClass,
} from "@/app/_components/ui";

type Instructor = { id: string; user: { name: string } };
type Deliverable = {
  id: string;
  title: string;
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
    instructorId: "", title: "", targetQuantity: 1, targetHours: 1, dueDate: "",
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
      setForm((f) => ({ ...f, title: "" }));
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliverables" />
        <Card padded><Skeleton className="h-24 w-full" /></Card>
        <Card padded><Skeleton className="h-32 w-full" /></Card>
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Deliverables" description="Assign work and track progress against target." />

      <Card>
        <CardHeader title="Assign a deliverable" />
        <CardBody>
          <form onSubmit={assign} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Instructor" className="lg:col-span-2">
                <select value={form.instructorId} onChange={(e) => setForm({ ...form, instructorId: e.target.value })} className={inputClass}>
                  {instructors.map((i) => <option key={i.id} value={i.id}>{i.user.name}</option>)}
                </select>
              </Field>
              <Field label="Title" className="lg:col-span-3">
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Quantity">
                <input type="number" min={1} value={form.targetQuantity} onChange={(e) => setForm({ ...form, targetQuantity: Number(e.target.value) })} className={inputClass} />
              </Field>
              <Field label="Hours">
                <input type="number" min={0.5} step={0.5} value={form.targetHours} onChange={(e) => setForm({ ...form, targetHours: Number(e.target.value) })} className={inputClass} />
              </Field>
              <Field label="Due date">
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputClass} />
              </Field>
            </div>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <Button type="submit" disabled={saving}>{saving ? "Assigning…" : "Assign"}</Button>
          </form>
        </CardBody>
      </Card>

      {instructors.length === 0 ? (
        <Card>
          <EmptyState
            title="No instructors yet"
            description="Add instructors before assigning deliverables."
          />
        </Card>
      ) : (
        instructors.map((i) => {
          const items = byInstructor[i.id] ?? [];
          return (
            <Card key={i.id}>
              <CardHeader title={i.user.name} />
              {items.length === 0 ? (
                <EmptyState title="No deliverables assigned" description="Use the form above to assign work." />
              ) : (
                <ul className="divide-y divide-line">
                  {items.map((d) => {
                    const done = d.logs.reduce((a, l) => a + l.quantityCompleted, 0);
                    const hours = d.logs.reduce((a, l) => a + l.hoursSpent, 0);
                    const pct = d.targetQuantity > 0 ? Math.round((done / d.targetQuantity) * 100) : 0;
                    return (
                      <li key={d.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="text-sm font-medium text-content">{d.title}</p>
                          <div className="flex items-center gap-2">
                            <p className="tabular text-sm text-muted">
                              {done}/{d.targetQuantity} · {hours}/{d.targetHours} hrs · due{" "}
                              {new Date(d.dueDate).toISOString().slice(0, 10)}
                            </p>
                            <Badge tone={d.status === "COMPLETED" ? "success" : d.status === "OVERDUE" ? "danger" : "neutral"}>
                              {d.status.replaceAll("_", " ")}
                            </Badge>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                          <div
                            className={pct >= 100 ? "h-full rounded-full bg-success" : "h-full rounded-full bg-primary"}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
