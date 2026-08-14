"use client";

/**
 * Assigning and tracking deliverables across the manager's instructors.
 *
 * Grouped by instructor rather than one flat list, because the question this
 * page answers is "is each person on track", not "here are all the rows".
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Section,
  Select,
  Skeleton,
  StatusPill,
  inputClass,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours } from "@/app/_lib/format";

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
  const toast = useToast();
  const [form, setForm] = useState({
    instructorId: "",
    title: "",
    targetQuantity: 1,
    targetHours: 1,
    dueDate: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await apiGet<{ instructors: Instructor[] }>(
      "/api/instructors",
      "Could not load instructors.",
    );
    const entries = await Promise.all(
      list.instructors.map(async (i) => {
        const r = await apiGet<{ deliverables: Deliverable[] }>(
          `/api/instructors/${i.id}/deliverables`,
          "Could not load deliverables.",
        ).catch(() => ({ deliverables: [] as Deliverable[] }));
        return [i.id, r.deliverables] as const;
      }),
    );
    return {
      instructors: list.instructors,
      byInstructor: Object.fromEntries(entries) as Record<string, Deliverable[]>,
    };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-deliverables");

  const instructorId = form.instructorId || data?.instructors[0]?.id || "";

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!instructorId || !form.title || !form.dueDate) {
      setFormError("Instructor, title and due date are required.");
      return;
    }
    setSaving(true);
    try {
      await apiSend(
        `/api/instructors/${instructorId}/deliverables`,
        "POST",
        {
          title: form.title,
          targetQuantity: Number(form.targetQuantity),
          targetHours: Number(form.targetHours),
          dueDate: form.dueDate,
        },
        "Could not assign that deliverable just now.",
      );
      toast("success", "Deliverable assigned.");
      setForm((f) => ({ ...f, title: "", dueDate: "" }));
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not assign that deliverable just now.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliverables" />
        <Card padded>
          <Skeleton className="h-24 w-full" />
        </Card>
        <Card padded>
          <Skeleton className="h-32 w-full" />
        </Card>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliverables" />
        <ErrorState message="Unable to load deliverables" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-8">
      <PageHeader title="Deliverables" description="Assign work and track progress against target." />

      <Card>
        <CardHeader title="Assign a deliverable" />
        <CardBody>
          <form onSubmit={assign} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Instructor" className="lg:col-span-2" required>
                <Select
                  value={instructorId}
                  onChange={(e) => setForm({ ...form, instructorId: e.target.value })}
                >
                  {data.instructors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.user.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Title" className="lg:col-span-3" required>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Target quantity" required>
                <input
                  type="number"
                  min={1}
                  value={form.targetQuantity}
                  onChange={(e) => setForm({ ...form, targetQuantity: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Target hours" required>
                <input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={form.targetHours}
                  onChange={(e) => setForm({ ...form, targetHours: Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Due date" required className="sm:col-span-2 lg:col-span-1">
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <Button type="submit" disabled={saving}>
              {saving ? "Assigning…" : "Assign deliverable"}
            </Button>
          </form>
        </CardBody>
      </Card>

      {data.instructors.length === 0 ? (
        <Card>
          <EmptyState
            title="No instructors yet"
            description="Add instructors before assigning deliverables."
          />
        </Card>
      ) : (
        <Section title="By instructor">
          <div className="space-y-4">
            {data.instructors.map((i) => {
              const items = data.byInstructor[i.id] ?? [];
              return (
                <Card key={i.id}>
                  <CardHeader
                    title={i.user.name}
                    description={`${items.length} deliverable${items.length === 1 ? "" : "s"}`}
                  />
                  {items.length === 0 ? (
                    <EmptyState
                      title="No deliverables assigned"
                      description="Use the form above to assign work."
                    />
                  ) : (
                    <ul className="divide-y divide-line">
                      {items.map((d) => {
                        const done = d.logs.reduce((a, l) => a + l.quantityCompleted, 0);
                        const hours = d.logs.reduce((a, l) => a + l.hoursSpent, 0);
                        const pct =
                          d.targetQuantity > 0
                            ? Math.min(100, Math.round((done / d.targetQuantity) * 100))
                            : 0;
                        return (
                          <li key={d.id} className="px-5 py-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-sm font-medium text-content">{d.title}</p>
                              <div className="flex items-center gap-2">
                                <p className="tabular text-sm text-muted">
                                  {done}/{d.targetQuantity} · {formatHours(hours)} of{" "}
                                  {formatHours(d.targetHours)} · due {formatDate(d.dueDate)}
                                </p>
                                <StatusPill status={d.status} />
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
