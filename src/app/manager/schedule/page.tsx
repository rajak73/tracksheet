"use client";

/**
 * Planning an instructor's day.
 *
 * Scheduling is a management action — instructors record what actually
 * happened, but only a manager or admin plans what is expected (enforced
 * server-side in the schedule route). This page is therefore the write side of
 * the same endpoint instructor/schedule reads.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  StatusPill,
  TableSkeleton,
  inputClass,
} from "@/app/_components/ui";
import { useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, useLoad } from "@/app/_lib/api";
import { formatDate, formatTimeRange } from "@/app/_lib/format";
import { useUniversityToday } from "@/app/_lib/zone";

type Instructor = { id: string; user: { name: string } };
type ActivityType = { id: string; code: string; label: string; isDerivedFromWorkingHours: boolean };
type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  location: string | null;
  status: string;
  activityType: { code: string; label: string };
};

export default function ManagerSchedulePage() {
  const toast = useToast();
  /* The UNIVERSITY's today, not the browser's — the server judges every day
   * boundary in the university's zone, so a browser a day out offers a date
   * the server then refuses. See `useUniversityToday`. */
  const today = useUniversityToday();
  const [date, setDate] = useState<string | null>(null);
  const at = date ?? today;
  const [instructorId, setInstructorId] = useState("");
  const [form, setForm] = useState({ code: "", start: "09:00", end: "10:00", location: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [instructors, types] = await Promise.all([
      apiGet<{ instructors: Instructor[] }>(
        "/api/instructors?limit=200",
        "Could not load instructors.",
      ),
      apiGet<{ activityTypes: ActivityType[] }>(
        "/api/activity-types",
        "Could not load activity types.",
      ),
    ]);
    const selectableTypes = types.activityTypes.filter((t) => !t.isDerivedFromWorkingHours);
    return { instructors: instructors.instructors, types: selectableTypes };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "manager-schedule-setup");

  const activeInstructorId = instructorId || data?.instructors[0]?.id || "";
  const activeCode = form.code || data?.types[0]?.code || "";

  const slotsLoad = useCallback(async () => {
    if (!activeInstructorId) return { slots: [] as Slot[], timezone: "UTC" };
    return apiGet<{ slots: Slot[]; timezone: string }>(
      `/api/instructors/${activeInstructorId}/schedule?date=${date}`,
      "Could not load the schedule for this date.",
    );
  }, [activeInstructorId, date]);

  const slots = useLoad(slotsLoad, `${activeInstructorId}:${date}`);

  async function addSlot(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!activeInstructorId) {
      setFormError("Choose an instructor.");
      return;
    }
    if (form.end <= form.start) {
      setFormError("The end time must be after the start time.");
      return;
    }

    setSaving(true);
    try {
      await apiSend(
        `/api/instructors/${activeInstructorId}/schedule`,
        "POST",
        {
          date,
          activityTypeCode: activeCode,
          startTime: new Date(`${date}T${form.start}:00`).toISOString(),
          endTime: new Date(`${date}T${form.end}:00`).toISOString(),
          location: form.location || undefined,
        },
        "Could not schedule that slot just now.",
      );
      toast("success", "Slot scheduled.");
      slots.reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not schedule that slot just now.");
    } finally {
      setSaving(false);
    }
  }

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Instructor" className="w-auto">
        <Select
          value={activeInstructorId}
          onChange={(e) => setInstructorId(e.target.value)}
          className="w-auto min-w-40"
        >
          {(data?.instructors ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.user.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Date" className="w-auto">
        <input
          type="date"
          value={at}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
      </Field>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" />
        <TableSkeleton cols={4} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" />
        <ErrorState message="Unable to load scheduling data" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  if (data.instructors.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" />
        <Card>
          <EmptyState
            title="No instructors yet"
            description="Add instructors before planning their schedule."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="Plan an instructor's day. They record what actually happened separately."
        actions={controls}
      />

      <Card>
        <CardHeader title="Add a slot" description={formatDate(at)} />
        <CardBody>
          <form onSubmit={addSlot} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Activity" required>
                <Select value={activeCode} onChange={(e) => setForm({ ...form, code: e.target.value })}>
                  {data.types.map((t) => (
                    <option key={t.id} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start" required>
                <input
                  type="time"
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="End" required>
                <input
                  type="time"
                  value={form.end}
                  onChange={(e) => setForm({ ...form, end: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Location" hint="Optional.">
                <input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className={inputClass}
                />
              </Field>
            </div>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}
            <Button type="submit" disabled={saving}>
              {saving ? "Scheduling…" : "Add slot"}
            </Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Planned slots" description={formatDate(at)} />
        {slots.loading ? (
          <div className="p-5">
            <TableSkeleton cols={3} rows={3} />
          </div>
        ) : slots.error ? (
          <div className="p-5">
            <ErrorState message="Unable to load slots" detail={slots.error} onRetry={slots.reload} />
          </div>
        ) : slots.data && slots.data.slots.length === 0 ? (
          <EmptyState title="Nothing planned for this date" description="Add the first slot above." />
        ) : (
          <CardList>
            {slots.data?.slots.map((s) => (
              <CardListItem
                key={s.id}
                title={s.activityType.label}
                subtitle={
                  <span className="tabular">
                    {formatTimeRange(s.startTime, s.endTime, slots.data!.timezone)}
                    {s.location ? ` · ${s.location}` : ""}
                  </span>
                }
                trailing={<StatusPill status={s.status} />}
              />
            ))}
          </CardList>
        )}
      </Card>
    </div>
  );
}
