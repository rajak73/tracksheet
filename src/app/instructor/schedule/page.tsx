"use client";

/**
 * An instructor's planned day, against what they actually recorded.
 *
 * The endpoint returns both `slots` (planned) and `logged` (recorded) for the
 * same date, so this page shows them side by side without joining anything in
 * the browser. Planned-versus-actual is the whole point of the view: a slot
 * with nothing recorded against it is the thing worth noticing.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Section,
  StatusPill,
  TableSkeleton,
  inputClass,
} from "@/app/_components/ui";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatTimeRange, todayISO } from "@/app/_lib/format";

type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  location: string | null;
  status: string;
  activityType: { code: string; label: string };
  course: { code: string; title: string } | null;
};

type Logged = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  scheduleSlotId: string | null;
  activityType: { code: string; label: string };
};

type Schedule = {
  date: string;
  timezone: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  opening: { startLocal: string; endLocal: string } | null;
  closing: { startLocal: string; endLocal: string } | null;
  slots: Slot[];
  logged: Logged[];
};

export default function InstructorSchedulePage() {
  const [date, setDate] = useState(todayISO());

  const load = useCallback(async (): Promise<Schedule> => {
    const me = await fetchMe();
    if (!me.user.instructorId) {
      throw new Error("No instructor profile is linked to this account.");
    }
    return apiGet<Schedule>(
      `/api/instructors/${me.user.instructorId}/schedule?date=${date}`,
      "Could not load your schedule for that date.",
    );
  }, [date]);

  const { data, error, loading, reload } = useLoad(load, date);

  const picker = (
    <Field label="Date" className="w-auto">
      <input
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        className={inputClass}
      />
    </Field>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" actions={picker} />
        <TableSkeleton cols={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Schedule" actions={picker} />
        <ErrorState message="Unable to load your schedule" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  /** A planned slot with no activity referencing it. Presentation only. */
  const loggedSlotIds = new Set(data.logged.map((l) => l.scheduleSlotId).filter(Boolean));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Schedule"
        description={`${formatDate(data.date)} · times shown in ${data.timezone}`}
        actions={picker}
      />

      {!data.isWorkingDay ? (
        <Alert tone="info" title="Not a working day">
          {data.nonWorkingReason === "HOLIDAY"
            ? "This date is a university holiday, so no capacity is expected."
            : "Your university is not scheduled to open on this day."}
        </Alert>
      ) : null}

      {data.isWorkingDay && data.opening && data.closing ? (
        <Card padded>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Daily opening
              </p>
              <p className="tabular mt-1 text-content">
                {data.opening.startLocal}–{data.opening.endLocal}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Daily closing
              </p>
              <p className="tabular mt-1 text-content">
                {data.closing.startLocal}–{data.closing.endLocal}
              </p>
            </div>
            <p className="max-w-md text-xs text-muted">
              These come from your university&apos;s configuration and are recorded from Today,
              not scheduled here.
            </p>
          </div>
        </Card>
      ) : null}

      <Section title="Planned" description="Slots your manager has scheduled for this date.">
        <Card>
          {data.slots.length === 0 ? (
            <EmptyState
              title="Nothing planned for this date"
              description="Your manager plans schedule slots. You can record any activity you carry out regardless."
            />
          ) : (
            <CardList>
              {data.slots.map((s) => (
                <CardListItem
                  key={s.id}
                  title={
                    <>
                      {s.activityType.label}
                      {s.course ? (
                        <span className="ml-2 font-normal text-muted">
                          {s.course.code} · {s.course.title}
                        </span>
                      ) : null}
                    </>
                  }
                  subtitle={
                    <span className="tabular">
                      {formatTimeRange(s.startTime, s.endTime, data.timezone)}
                      {s.location ? ` · ${s.location}` : ""}
                    </span>
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      {!loggedSlotIds.has(s.id) ? (
                        <Badge tone="warning">Nothing recorded</Badge>
                      ) : null}
                      <StatusPill status={s.status} />
                    </div>
                  }
                />
              ))}
            </CardList>
          )}
        </Card>
      </Section>

      <Section title="Recorded" description="What you actually logged on this date.">
        <Card>
          <CardHeader title="Recorded activity" />
          {data.logged.length === 0 ? (
            <EmptyState
              title="No activity recorded for this date"
              description="This shows as missing data rather than as zero hours worked."
            />
          ) : (
            <CardList>
              {data.logged.map((l) => (
                <CardListItem
                  key={l.id}
                  title={l.activityType.label}
                  subtitle={
                    <span className="tabular">
                      {formatTimeRange(l.startTime, l.endTime, data.timezone)}
                    </span>
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      {l.scheduleSlotId ? <Badge tone="info">Against a slot</Badge> : null}
                      <StatusPill status={l.status} />
                    </div>
                  }
                />
              ))}
            </CardList>
          )}
        </Card>
      </Section>
    </div>
  );
}
