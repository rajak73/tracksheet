"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState,
  Field, PageHeader, Table, TableSkeleton, TableWrap, TBody, TD, THead, TR, inputClass,
} from "@/app/_components/ui";

type ActivityType = {
  id: string; code: string; label: string;
  isOncePerDay: boolean; isDerivedFromWorkingHours: boolean;
};
type Activity = {
  id: string; workDate: string; startTime: string; endTime: string;
  status: string; remarks: string | null;
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
        if (!meRes.ok) return setError("Your session has expired.");
        const me = await meRes.json();
        const iid = me.user.instructorId as string | null;
        if (!iid) return setError("No instructor profile is linked to this account.");
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
        // The server's own reason is useful — "endTime must be after startTime"
        // tells you what to change; "error" does not.
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

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My activities" />
        <TableSkeleton cols={5} />
      </div>
    );
  }
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My activities"
        description="Record teaching, learning, support and other work. Only your own records are visible here."
      />

      <Card>
        <CardHeader
          title="Record an activity"
          description="Daily opening and closing are recorded from Today, against your university's configured window."
        />
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Activity" className="lg:col-span-2">
                <select value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={inputClass}>
                  {types.map((t) => <option key={t.id} value={t.code}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Start">
                <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} className={inputClass} />
              </Field>
              <Field label="End">
                <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Remarks" hint="Optional." className="sm:col-span-2 lg:col-span-5">
                <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} className={inputClass} />
              </Field>
            </div>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            {success ? <Alert tone="success">{success}</Alert> : null}
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Record"}</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Recorded activity" />
        {activities.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Use the form above to record your first activity — it appears in your workload immediately."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead columns={[{ label: "Date" }, { label: "Activity" }, { label: "Time (UTC)" }, { label: "Status" }, { label: "Remarks" }]} />
              <TBody>
                {activities.map((a) => (
                  <TR key={a.id}>
                    <TD className="tabular">{new Date(a.workDate).toISOString().slice(0, 10)}</TD>
                    <TD strong>{a.activityType.label}</TD>
                    <TD className="tabular">{time(a.startTime)}–{time(a.endTime)}</TD>
                    <TD><Badge tone={a.status === "COMPLETED" ? "success" : "neutral"}>{a.status}</Badge></TD>
                    <TD>{a.remarks ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
