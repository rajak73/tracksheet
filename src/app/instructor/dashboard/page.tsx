"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState,
  PageHeader, StatGridSkeleton, StatTile, Skeleton, utilizationTone,
} from "@/app/_components/ui";

type Deliverable = {
  id: string;
  title: string;
  targetQuantity: number;
  targetHours: number;
  dueDate: string;
  status: string;
};

type DayBreakdown = {
  date: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number | null;
  hasData: boolean;
  openingLogged: boolean;
  closingLogged: boolean;
};

type Personal = {
  from: string;
  to: string;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  hoursByActivityType: Record<string, number>;
  days: DayBreakdown[];
};

type PersonalInsight = { type: string; severity: string; title?: string; summary?: string; recommendation: string };

type ScheduleSlot = {
  id: string;
  startTime: string;
  endTime: string;
  location: string | null;
  status: string;
  activityType: { code: string; label: string };
  course: { code: string; title: string } | null;
};

type Windows = {
  date: string;
  isWorkingDay: boolean;
  nonWorkingReason: string | null;
  opening: { startLocal: string; endLocal: string } | null;
  closing: { startLocal: string; endLocal: string } | null;
};

const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16);

export default function InstructorDashboardPage() {
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [today, setToday] = useState<Windows | null>(null);
  const [instructorId, setInstructorId] = useState<string | null>(null);
  const [insights, setInsights] = useState<PersonalInsight[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        setError("Your session has expired.");
        return;
      }
      const me = await meRes.json();
      const iid = me.user.instructorId as string | null;
      const uid = me.user.universityId as string;
      setInstructorId(iid);
      if (!iid) {
        setError("No instructor profile is linked to this account.");
        return;
      }

      const [dRes, aRes, iRes] = await Promise.all([
        fetch(`/api/instructors/${iid}/deliverables`),
        fetch(`/api/universities/${uid}/analytics`),
        fetch(`/api/instructors/${iid}/insights`),
      ]);

      if (dRes.ok) setDeliverables((await dRes.json()).deliverables);
      if (iRes.ok) setInsights((await iRes.json()).insights);

      if (aRes.ok) {
        const analytics = (await aRes.json()).analytics;
        const mine = analytics.instructors[0];
        if (mine) {
          setPersonal({
            from: analytics.from,
            to: analytics.to,
            capacityHours: mine.capacityHours,
            productiveHours: mine.productiveHours,
            unutilizedHours: mine.unutilizedHours,
            missingDataHours: mine.missingDataHours,
            utilizationPct: mine.utilizationPct,
            hoursByActivityType: mine.hoursByActivityType,
            days: mine.days,
          });

          const lastDay = mine.days[mine.days.length - 1];
          if (lastDay) {
            const [wRes, sRes] = await Promise.all([
              fetch(`/api/universities/${uid}/windows?date=${lastDay.date}`),
              fetch(`/api/instructors/${iid}/schedule?date=${lastDay.date}`),
            ]);
            if (wRes.ok) setToday((await wRes.json()).windows);
            if (sRes.ok) setSlots((await sRes.json()).slots);
          }
        }
      }
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function logDaily(kind: "DAILY_OPENING" | "DAILY_CLOSING") {
    if (!instructorId || !today) return;
    const window = kind === "DAILY_OPENING" ? today.opening : today.closing;
    if (!window) return;

    setLogging(true);
    try {
      const toIso = (t: string) => `${today.date}T${t}:00`;
      await fetch(`/api/instructors/${instructorId}/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityTypeCode: kind,
          startTime: new Date(toIso(window.startLocal)).toISOString(),
          endTime: new Date(toIso(window.endLocal)).toISOString(),
        }),
      });
      await load();
    } finally {
      setLogging(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Today" />
        <Card padded>
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 flex gap-3">
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-9 w-56" />
          </div>
        </Card>
        <StatGridSkeleton />
      </div>
    );
  }

  if (error) return <ErrorState message={error} />;

  const todayRow = personal?.days[personal.days.length - 1];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Today"
        description={personal ? `Your week · ${personal.from} to ${personal.to}` : undefined}
        actions={
          <Link
            href="/instructor/activities"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Record activity
          </Link>
        }
      />

      {/* Opening and closing come first: they are the two things this page
          exists to prompt, and both are once-per-day. */}
      {today ? (
        <Card>
          <CardHeader
            title={today.date}
            description={
              today.isWorkingDay
                ? "Record your daily opening and closing against the configured windows."
                : undefined
            }
            actions={
              !today.isWorkingDay ? (
                <Badge tone="neutral">
                  {today.nonWorkingReason === "HOLIDAY" ? "Holiday" : "Non-working day"}
                </Badge>
              ) : null
            }
          />
          <CardBody>
            {today.isWorkingDay && today.opening && today.closing ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  variant={todayRow?.openingLogged ? "secondary" : "primary"}
                  onClick={() => logDaily("DAILY_OPENING")}
                  disabled={logging || todayRow?.openingLogged}
                  className="flex-1"
                >
                  {todayRow?.openingLogged
                    ? `Opening recorded · ${today.opening.startLocal}–${today.opening.endLocal}`
                    : `Record opening · ${today.opening.startLocal}–${today.opening.endLocal}`}
                </Button>
                <Button
                  variant={todayRow?.closingLogged ? "secondary" : "primary"}
                  onClick={() => logDaily("DAILY_CLOSING")}
                  disabled={logging || todayRow?.closingLogged}
                  className="flex-1"
                >
                  {todayRow?.closingLogged
                    ? `Closing recorded · ${today.closing.startLocal}–${today.closing.endLocal}`
                    : `Record closing · ${today.closing.startLocal}–${today.closing.endLocal}`}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">
                No opening or closing is expected on a non-working day.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {todayRow ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Today · productive" value={todayRow.productiveHours} suffix="hrs" emphasis />
          <StatTile label="Today · capacity" value={todayRow.capacityHours} suffix="hrs" />
          <StatTile
            label="Today · unutilized"
            value={todayRow.unutilizedHours}
            suffix="hrs"
            tone={todayRow.unutilizedHours && todayRow.unutilizedHours > 0 ? "warning" : "neutral"}
            hint={todayRow.unutilizedHours === null ? "Nothing recorded yet" : undefined}
          />
          <StatTile
            label="Open / close"
            value={`${todayRow.openingLogged ? "✓" : "—"} / ${todayRow.closingLogged ? "✓" : "—"}`}
          />
        </div>
      ) : null}

      {today?.isWorkingDay ? (
        <Card>
          <CardHeader title="Today's schedule" />
          {slots.length === 0 ? (
            <EmptyState
              title="Nothing scheduled today"
              description="Your manager plans schedule slots. You can still record any activity you carry out."
              action={
                <Link
                  href="/instructor/activities"
                  className="rounded-lg border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-content hover:bg-hovered"
                >
                  Record an activity
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {slots.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content">
                      {s.activityType.label}
                      {s.course ? ` · ${s.course.code}` : ""}
                    </p>
                    <p className="tabular mt-0.5 text-sm text-muted">
                      {hhmm(s.startTime)}–{hhmm(s.endTime)} UTC
                      {s.location ? ` · ${s.location}` : ""}
                    </p>
                  </div>
                  <Badge tone="neutral">{s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {personal ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Week · utilization"
              value={personal.utilizationPct}
              suffix="%"
              tone={utilizationTone(personal.utilizationPct)}
            />
            <StatTile label="Week · capacity" value={personal.capacityHours} suffix="hrs" />
            <StatTile label="Week · productive" value={personal.productiveHours} suffix="hrs" />
            <StatTile label="Week · unutilized" value={personal.unutilizedHours} suffix="hrs" />
          </div>

          {personal.missingDataHours > 0 ? (
            <Alert tone="warning" title="Some of your working time has no records">
              {personal.missingDataHours} hours have no activity recorded. This shows as missing
              data, not as time you did not work.
            </Alert>
          ) : null}

          {Object.keys(personal.hoursByActivityType).length > 0 ? (
            <Card>
              <CardHeader title="Hours by activity" description="This week." />
              <CardBody>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {Object.entries(personal.hoursByActivityType).map(([code, hrs]) => (
                    <li
                      key={code}
                      className="flex items-center justify-between rounded-lg bg-sunken px-3 py-2 text-sm"
                    >
                      <span className="truncate text-muted">{code.replaceAll("_", " ")}</span>
                      <span className="tabular ml-2 font-medium text-content">{hrs}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}

      {insights.length > 0 ? (
        <Card>
          <CardHeader
            title="Personal insights"
            description="Derived from your own recorded activity only."
          />
          <ul className="divide-y divide-line">
            {insights.map((i, idx) => (
              <li key={`${i.type}-${idx}`} className="px-5 py-4">
                <p className="text-sm font-medium text-content">
                  {i.title ?? i.type.replaceAll("_", " ")}
                </p>
                {i.summary ? <p className="mt-1 text-sm text-muted">{i.summary}</p> : null}
                <p className="mt-1 text-sm text-muted">{i.recommendation}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="My deliverables" />
        {deliverables.length === 0 ? (
          <EmptyState
            title="No deliverables assigned"
            description="Your manager assigns deliverables. They will appear here with their target and due date."
          />
        ) : (
          <ul className="divide-y divide-line">
            {deliverables.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content">{d.title}</p>
                  <p className="tabular mt-0.5 text-sm text-muted">
                    Target {d.targetQuantity} · {d.targetHours} hrs · due{" "}
                    {new Date(d.dueDate).toISOString().slice(0, 10)}
                  </p>
                </div>
                <Badge tone={d.status === "COMPLETED" ? "success" : d.status === "OVERDUE" ? "danger" : "neutral"}>
                  {d.status.replaceAll("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
