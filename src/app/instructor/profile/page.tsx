"use client";

/**
 * The instructor's own account and working configuration.
 *
 * Read-mostly by design: an instructor may see the working hours they are
 * measured against and submit leave, but cannot change either. Working hours
 * are university configuration (admin-only), and leave is approved by a
 * manager — self-approval would let someone improve their own utilisation
 * figure by declaring a day off. The page states both rules rather than
 * silently disabling controls.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  DescriptionList,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Section,
  StatusPill,
  Skeleton,
  inputClass,
} from "@/app/_components/ui";
import { Dialog, useToast } from "@/app/_components/interactive";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatMinuteOfDay, todayISO } from "@/app/_lib/format";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Config = {
  timezone: string;
  openingDurationMin: number;
  closingDurationMin: number;
  workingHours: Array<{
    dayOfWeek: number;
    isWorkingDay: boolean;
    startMinute: number;
    endMinute: number;
  }>;
};

type Leave = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string | null;
};

export default function InstructorProfilePage() {
  const toast = useToast();
  const [requesting, setRequesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ startDate: todayISO(), endDate: todayISO(), reason: "" });

  const load = useCallback(async () => {
    const me = await fetchMe();
    const { instructorId, universityId } = me.user;
    if (!instructorId || !universityId) {
      throw new Error("No instructor profile is linked to this account.");
    }

    const [profile, config, leave] = await Promise.all([
      apiGet<{ instructor: { employeeCode: string | null; university: { name: string } } }>(
        `/api/instructors/${instructorId}`,
        "Could not load your profile.",
      ),
      apiGet<{ config: Config }>(
        `/api/universities/${universityId}/config`,
        "Could not load your university's working hours.",
      ),
      apiGet<{ leaveRequests: Leave[] }>(
        `/api/instructors/${instructorId}/leave`,
        "Could not load your leave requests.",
      ).catch(() => ({ leaveRequests: [] })),
    ]);

    return {
      instructorId,
      user: me.user,
      employeeCode: profile.instructor.employeeCode,
      universityName: profile.instructor.university.name,
      config: config.config,
      leave: leave.leaveRequests,
    };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "instructor-profile");

  async function submitLeave() {
    if (!data) return;
    setFormError(null);

    if (form.endDate < form.startDate) {
      setFormError("The end date cannot be before the start date.");
      return;
    }

    setSaving(true);
    try {
      await apiSend(
        `/api/instructors/${data.instructorId}/leave`,
        "POST",
        {
          startDate: form.startDate,
          endDate: form.endDate,
          reason: form.reason || undefined,
        },
        "Could not submit that leave request just now.",
      );
      toast("success", "Leave request submitted for approval.");
      setRequesting(false);
      setForm({ startDate: todayISO(), endDate: todayISO(), reason: "" });
      reload();
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "Could not submit that leave request just now.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Profile" />
        <Card padded>
          <Skeleton className="h-20 w-full" />
        </Card>
        <Card padded>
          <Skeleton className="h-40 w-full" />
        </Card>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Profile" />
        <ErrorState message="Unable to load your profile" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-8">
      <PageHeader title="Profile" description="Your account and the hours you are measured against." />

      <Card>
        <CardHeader title="Account" />
        <CardBody>
          <DescriptionList
            items={[
              { label: "Name", value: data.user.name },
              { label: "Email", value: data.user.email },
              { label: "Employee code", value: data.employeeCode ?? "—" },
              { label: "University", value: data.universityName },
            ]}
          />
        </CardBody>
      </Card>

      <Section
        title="Working hours"
        description="Set by your university administrator. These determine the capacity your utilization is measured against."
      >
        <Card>
          <CardHeader
            title="Weekly pattern"
            actions={<Badge tone="info">{data.config.timezone}</Badge>}
          />
          <CardBody>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[...data.config.workingHours]
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                .map((h) => (
                  <li
                    key={h.dayOfWeek}
                    className="flex items-center justify-between rounded-control bg-sunken px-3 py-2 text-sm"
                  >
                    <span className="text-muted">{DAYS[h.dayOfWeek]}</span>
                    <span className={h.isWorkingDay ? "tabular text-content" : "text-subtle"}>
                      {h.isWorkingDay
                        ? `${formatMinuteOfDay(h.startMinute)}–${formatMinuteOfDay(h.endMinute)}`
                        : "Closed"}
                    </span>
                  </li>
                ))}
            </ul>

            <p className="mt-4 text-sm text-muted">
              Daily opening takes {data.config.openingDurationMin} minutes and closing{" "}
              {data.config.closingDurationMin} minutes. Both count toward your capacity — they
              are part of the working day, not overhead deducted from it.
            </p>
          </CardBody>
        </Card>
      </Section>

      <Section
        title="Leave"
        actions={
          <Button size="sm" variant="secondary" onClick={() => setRequesting(true)}>
            Request leave
          </Button>
        }
      >
        <Card>
          <CardHeader
            title="Your leave requests"
            description="Approved leave reduces the capacity you are measured against, so it is approved by your manager rather than by you."
          />
          {data.leave.length === 0 ? (
            <EmptyState
              title="No leave requested"
              description="Submit a request and it appears here while it waits for approval."
              action={
                <Button variant="secondary" onClick={() => setRequesting(true)}>
                  Request leave
                </Button>
              }
            />
          ) : (
            <CardList>
              {data.leave.map((l) => (
                <CardListItem
                  key={l.id}
                  title={
                    l.startDate === l.endDate
                      ? formatDate(l.startDate)
                      : `${formatDate(l.startDate)} – ${formatDate(l.endDate)}`
                  }
                  subtitle={l.reason ?? "No reason given"}
                  trailing={<StatusPill status={l.status} />}
                />
              ))}
            </CardList>
          )}
        </Card>
      </Section>

      <Dialog
        open={requesting}
        onClose={() => setRequesting(false)}
        title="Request leave"
        description="Your manager reviews and approves this."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRequesting(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitLeave} disabled={saving}>
              {saving ? "Submitting…" : "Submit request"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="From" required>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="To" required>
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
          <Field label="Reason" hint="Optional.">
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className={inputClass}
            />
          </Field>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
        </div>
      </Dialog>
    </div>
  );
}
