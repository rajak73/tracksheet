"use client";

/**
 * An instructor's own deliverables, with progress logging.
 *
 * Progress figures come from the logs the server returns; the percentage bar is
 * the one derived value and it is presentation of a ratio the server already
 * gave both sides of. Nothing here decides whether a deliverable is complete —
 * `status` arrives from the backend.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  StatTile,
  StatusPill,
  TableSkeleton,
  inputClass,
} from "@/app/_components/ui";
import { Dialog, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours } from "@/app/_lib/format";
import { useUniversityToday } from "@/app/_lib/zone";

type Deliverable = {
  id: string;
  title: string;
  description: string | null;
  targetQuantity: number;
  targetHours: number;
  dueDate: string;
  status: string;
  logs: Array<{ id: string; quantityCompleted: number; hoursSpent: number; logDate: string }>;
};

export default function InstructorDeliverablesPage() {
  /* The UNIVERSITY's today, not the browser's — the server judges every day
   * boundary in the university's zone, so a browser a day out offers a date
   * the server then refuses. See `useUniversityToday`. */
  const today = useUniversityToday();
  const toast = useToast();
  const [active, setActive] = useState<Deliverable | null>(null);
  const [form, setForm] = useState({
    quantity: 1,
    hours: 1,
    workDate: "",
    remarks: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.instructorId) {
      throw new Error("No instructor profile is linked to this account.");
    }
    const body = await apiGet<{ deliverables: Deliverable[] }>(
      `/api/instructors/${me.user.instructorId}/deliverables?limit=200`,
      "Could not load your deliverables.",
    );
    return { instructorId: me.user.instructorId, deliverables: body.deliverables };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "instructor-deliverables");

  async function logProgress() {
    if (!data || !active) return;
    setFormError(null);

    if (form.quantity < 0 || form.hours < 0) {
      setFormError("Quantity and hours cannot be negative.");
      return;
    }
    if (!form.workDate) {
      setFormError("Pick the date this work was done.");
      return;
    }

    setSaving(true);
    try {
      await apiSend(
        `/api/instructors/${data.instructorId}/deliverables/${active.id}/logs`,
        "POST",
        {
          workDate: form.workDate || today,
          quantityCompleted: Number(form.quantity),
          hoursSpent: Number(form.hours),
          remarks: form.remarks || undefined,
        },
        "Could not record that progress just now.",
      );
      toast("success", "Progress recorded.");
      setActive(null);
      setForm({ quantity: 1, hours: 1, workDate: today, remarks: "" });
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not record that progress just now.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliverables" />
        <TableSkeleton cols={4} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Deliverables" />
        <ErrorState message="Unable to load your deliverables" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  const open = data.deliverables.filter((d) => d.status !== "COMPLETED");
  const done = data.deliverables.filter((d) => d.status === "COMPLETED");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deliverables"
        description="Work assigned to you, and the progress you have recorded against it."
      />

      {data.deliverables.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Assigned" value={data.deliverables.length} emphasis />
          <StatTile label="Outstanding" value={open.length} tone={open.length > 0 ? "warning" : "neutral"} />
          <StatTile label="Completed" value={done.length} tone="success" />
          <StatTile
            label="Overdue"
            value={data.deliverables.filter((d) => d.status === "OVERDUE").length}
            tone={
              data.deliverables.some((d) => d.status === "OVERDUE") ? "danger" : "neutral"
            }
          />
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Assigned to you"
          description="Record progress as you go — it feeds your workload figures immediately."
        />
        {data.deliverables.length === 0 ? (
          <EmptyState
            title="No deliverables assigned"
            description="Your manager assigns deliverables. They will appear here with their target and due date."
          />
        ) : (
          <ul className="divide-y divide-line">
            {data.deliverables.map((d) => {
              const quantityDone = d.logs.reduce((sum, l) => sum + l.quantityCompleted, 0);
              const hoursDone = d.logs.reduce((sum, l) => sum + l.hoursSpent, 0);
              const pct =
                d.targetQuantity > 0
                  ? Math.min(100, Math.round((quantityDone / d.targetQuantity) * 100))
                  : 0;

              return (
                <li key={d.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-content">{d.title}</p>
                      {d.description ? (
                        <p className="mt-0.5 text-sm text-muted">{d.description}</p>
                      ) : null}
                      <p className="tabular mt-1 text-sm text-muted">
                        {quantityDone}/{d.targetQuantity} · {formatHours(hoursDone)} of{" "}
                        {formatHours(d.targetHours)} · due {formatDate(d.dueDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusPill status={d.status} />
                      {d.status !== "COMPLETED" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setActive(d);
                            setFormError(null);
                          }}
                        >
                          Log progress
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="tabular w-10 text-right text-xs text-muted">{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog
        open={active !== null}
        onClose={() => setActive(null)}
        title="Log progress"
        description={active?.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setActive(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={logProgress} disabled={saving}>
              {saving ? "Saving…" : "Record progress"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Date this work was done" required>
            <input
              type="date"
              value={form.workDate || today}
              onChange={(e) => setForm({ ...form, workDate: e.target.value })}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Quantity completed" required>
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
            <Field label="Hours spent" required>
              <input
                type="number"
                min={0}
                step={0.5}
                value={form.hours}
                onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Remarks" hint="Optional.">
            <input
              value={form.remarks}
              onChange={(e) => setForm({ ...form, remarks: e.target.value })}
              className={inputClass}
            />
          </Field>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
        </div>
      </Dialog>
    </div>
  );
}
