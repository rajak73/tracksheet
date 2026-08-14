"use client";

/**
 * The instructor's day.
 *
 * This is the most-opened page in the product and the one most likely to be
 * read on a phone between classes, so it is ordered by what someone standing
 * in a corridor needs (§18): where am I in the day, what is next, what have I
 * recorded, what is outstanding. Analysis comes last, or on the Analytics page.
 *
 * Everything here is rendered from server-calculated figures. The page does not
 * add up hours, derive capacity or decide what counts as productive — it asks
 * which slot comes next, and that is all.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  CardList,
  CardListItem,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  StatGridSkeleton,
  StatTile,
  StatusPill,
  Skeleton,
  utilizationLabel,
  utilizationTone,
} from "@/app/_components/ui";
import { AllocationBar, BarCompare, ChartCard } from "@/app/_components/charts";
import { InsightCard, useToast } from "@/app/_components/interactive";
import { IconCheck, IconClock, IconPlus } from "@/app/_components/icons";
import { apiGet, apiSend, fetchMe, useLoad } from "@/app/_lib/api";
import {
  formatDate,
  formatHours,
  formatTimeRange,
  formatWeekday,
} from "@/app/_lib/format";

type Day = {
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

type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  location: string | null;
  status: string;
  activityType: { code: string; label: string };
  course: { code: string; title: string } | null;
};

type Deliverable = {
  id: string;
  title: string;
  targetQuantity: number;
  targetHours: number;
  dueDate: string;
  status: string;
};

type Insight = {
  type: string;
  severity: string;
  title?: string;
  summary?: string;
  recommendation: string;
  sourceMetrics?: Record<string, unknown> | null;
};

type Dashboard = {
  instructorId: string;
  timezone: string;
  today: {
    date: string;
    isWorkingDay: boolean;
    nonWorkingReason: string | null;
    opening: { startLocal: string; endLocal: string } | null;
    closing: { startLocal: string; endLocal: string } | null;
  } | null;
  week: {
    from: string;
    to: string;
    capacityHours: number;
    productiveHours: number;
    unutilizedHours: number;
    missingDataHours: number;
    utilizationPct: number | null;
    hoursByActivityType: Record<string, number>;
    days: Day[];
  } | null;
  slots: Slot[];
  deliverables: Deliverable[];
  insights: Insight[];
};

export default function InstructorDashboardPage() {
  const toast = useToast();
  const [logging, setLogging] = useState(false);

  const load = useCallback(async (): Promise<Dashboard> => {
    const me = await fetchMe();
    const instructorId = me.user.instructorId;
    const universityId = me.user.universityId;

    if (!instructorId || !universityId) {
      throw new Error("No instructor profile is linked to this account.");
    }

    const [analytics, deliverables, insights] = await Promise.all([
      apiGet<{ analytics: { from: string; to: string; timezone?: string; instructors: Array<Record<string, unknown>> } }>(
        `/api/universities/${universityId}/analytics`,
        "Could not load your workload for this period.",
      ),
      apiGet<{ deliverables: Deliverable[] }>(
        `/api/instructors/${instructorId}/deliverables`,
        "Could not load your deliverables.",
      ).catch(() => ({ deliverables: [] })),
      apiGet<{ insights: Insight[] }>(
        `/api/instructors/${instructorId}/insights`,
        "Could not load your insights.",
      ).catch(() => ({ insights: [] })),
    ]);

    // An instructor's `self` scope narrows this to exactly one row: their own.
    const mine = analytics.analytics.instructors[0] as
      | (Dashboard["week"] & { days: Day[] })
      | undefined;

    const latest = mine?.days?.[mine.days.length - 1];

    let today: Dashboard["today"] = null;
    let slots: Slot[] = [];
    let timezone = "UTC";

    if (latest) {
      const [windows, schedule] = await Promise.all([
        apiGet<{ windows: NonNullable<Dashboard["today"]> }>(
          `/api/universities/${universityId}/windows?date=${latest.date}`,
          "Could not load today's working window.",
        ).catch(() => null),
        apiGet<{ slots: Slot[]; timezone: string }>(
          `/api/instructors/${instructorId}/schedule?date=${latest.date}`,
          "Could not load today's schedule.",
        ).catch(() => null),
      ]);
      today = windows?.windows ?? null;
      slots = schedule?.slots ?? [];
      timezone = schedule?.timezone ?? "UTC";
    }

    return {
      instructorId,
      timezone,
      today,
      week: mine
        ? {
            from: analytics.analytics.from,
            to: analytics.analytics.to,
            capacityHours: mine.capacityHours,
            productiveHours: mine.productiveHours,
            unutilizedHours: mine.unutilizedHours,
            missingDataHours: mine.missingDataHours,
            utilizationPct: mine.utilizationPct,
            hoursByActivityType: mine.hoursByActivityType,
            days: mine.days,
          }
        : null,
      slots,
      deliverables: deliverables.deliverables,
      insights: insights.insights,
    };
  }, []);

  const { data, error, loading, reload } = useLoad(load, "instructor-dashboard");

  const todayRow = data?.week?.days[data.week.days.length - 1];

  /**
   * The next slot that has not finished yet. Purely a reading of the clock
   * against times the server supplied — no duration is computed here.
   *
   * `Date.now()` is impure, so it is read in an effect rather than during
   * render (component bodies must be pure) and stored as state; the
   * derivation from `now` back to `nextSlot` below stays a plain, pure read.
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
  }, [data?.slots]);

  const nextSlot =
    now === null || !data?.slots.length
      ? null
      : (data.slots.find((s) => new Date(s.endTime).getTime() > now) ?? null);

  async function logDaily(kind: "DAILY_OPENING" | "DAILY_CLOSING") {
    if (!data?.instructorId || !data.today) return;
    const window = kind === "DAILY_OPENING" ? data.today.opening : data.today.closing;
    if (!window) return;

    setLogging(true);
    try {
      // The window's startLocal/endLocal are already UNIVERSITY-local wall
      // clock; sending them as `local` lets the server resolve the zone.
      // Building an instant here with `new Date(...)` read the BROWSER's
      // zone and could record the opening against the wrong workDate.
      await apiSend(
        `/api/instructors/${data.instructorId}/activities`,
        "POST",
        {
          activityTypeCode: kind,
          local: { date: data.today.date, start: window.startLocal, end: window.endLocal },
        },
        "Could not record that just now.",
      );
      toast("success", kind === "DAILY_OPENING" ? "Opening recorded." : "Closing recorded.");
      reload();
    } catch (e) {
      toast("danger", e instanceof Error ? e.message : "Could not record that just now.");
    } finally {
      setLogging(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Today" />
        <Card padded>
          <Skeleton className="h-5 w-40" />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 flex-1" />
          </div>
        </Card>
        <StatGridSkeleton />
      </div>
    );
  }

  if (error) return <ErrorState message="Unable to load your day" detail={error} onRetry={reload} />;
  if (!data) return <ErrorState message="Unable to load your day" onRetry={reload} />;

  const { today, week } = data;
  const dueSoon = data.deliverables.filter((d) => d.status !== "COMPLETED");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Today"
        description={today ? formatDate(today.date) : undefined}
        actions={
          <ButtonLink href="/instructor/activities">
            <IconPlus size={16} />
            Record activity
          </ButtonLink>
        }
      />

      {/* 1 — Current status. The two once-per-day actions come first because
          they are the only thing on this page that has a deadline. */}
      {today ? (
        <Card>
          <CardHeader
            title="Daily opening and closing"
            description={
              today.isWorkingDay
                ? "Recorded against your university's configured window."
                : "No opening or closing is expected today."
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
                  {todayRow?.openingLogged ? <IconCheck size={16} /> : <IconClock size={16} />}
                  {todayRow?.openingLogged ? "Opening recorded" : "Record opening"}
                  <span className="tabular text-xs opacity-75">
                    {today.opening.startLocal}–{today.opening.endLocal}
                  </span>
                </Button>
                <Button
                  variant={todayRow?.closingLogged ? "secondary" : "primary"}
                  onClick={() => logDaily("DAILY_CLOSING")}
                  disabled={logging || todayRow?.closingLogged}
                  className="flex-1"
                >
                  {todayRow?.closingLogged ? <IconCheck size={16} /> : <IconClock size={16} />}
                  {todayRow?.closingLogged ? "Closing recorded" : "Record closing"}
                  <span className="tabular text-xs opacity-75">
                    {today.closing.startLocal}–{today.closing.endLocal}
                  </span>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Your university is not scheduled to open today, so no opening or closing is
                expected.
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* 2 — What is next. Ahead of the numbers: at 10am, the next class
          matters more than the week's utilisation. */}
      {today?.isWorkingDay ? (
        <Section title="Schedule" description={`Times shown in ${data.timezone}.`}>
          {nextSlot ? (
            <Alert tone="info" title={`Next: ${nextSlot.activityType.label}`}>
              {formatTimeRange(nextSlot.startTime, nextSlot.endTime, data.timezone)}
              {nextSlot.course ? ` · ${nextSlot.course.code}` : ""}
              {nextSlot.location ? ` · ${nextSlot.location}` : ""}
            </Alert>
          ) : null}

          <Card>
            {data.slots.length === 0 ? (
              <EmptyState
                title="Nothing scheduled today"
                description="Your manager plans schedule slots. You can still record any activity you carry out."
                action={
                  <ButtonLink href="/instructor/activities" variant="secondary">
                    Record an activity
                  </ButtonLink>
                }
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
                          <span className="ml-2 font-normal text-muted">{s.course.code}</span>
                        ) : null}
                      </>
                    }
                    subtitle={
                      <span className="tabular">
                        {formatTimeRange(s.startTime, s.endTime, data.timezone)}
                        {s.location ? ` · ${s.location}` : ""}
                      </span>
                    }
                    trailing={<StatusPill status={s.status} />}
                  />
                ))}
              </CardList>
            )}
          </Card>
        </Section>
      ) : null}

      {/* 3 — Today's work summary. */}
      {todayRow ? (
        <Section title="Today's work">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Recorded"
              value={todayRow.productiveHours}
              suffix="hrs"
              emphasis
              timeframe="Today"
            />
            <StatTile
              label="Available"
              value={todayRow.capacityHours}
              suffix="hrs"
              hint="Excludes breaks, holidays and leave"
            />
            <StatTile
              label="Unutilized"
              value={todayRow.unutilizedHours}
              suffix="hrs"
              tone={
                todayRow.unutilizedHours && todayRow.unutilizedHours > 0 ? "warning" : "neutral"
              }
              hint={
                todayRow.unutilizedHours === null
                  ? "Nothing recorded yet — this is missing data, not zero hours"
                  : undefined
              }
            />
            <StatTile
              label="Opening / closing"
              value={`${todayRow.openingLogged ? "✓" : "—"} / ${todayRow.closingLogged ? "✓" : "—"}`}
              status={
                todayRow.openingLogged && todayRow.closingLogged
                  ? "Both recorded"
                  : "Outstanding"
              }
              tone={todayRow.openingLogged && todayRow.closingLogged ? "success" : "warning"}
            />
          </div>
        </Section>
      ) : null}

      {/* 4 — Deliverables. */}
      <Section
        title="Deliverables"
        actions={
          data.deliverables.length > 0 ? (
            <ButtonLink href="/instructor/deliverables" variant="ghost" size="sm">
              View all
            </ButtonLink>
          ) : null
        }
      >
        <Card>
          {dueSoon.length === 0 ? (
            <EmptyState
              title="No deliverables assigned"
              description="Your manager assigns deliverables. They appear here with their target and due date."
            />
          ) : (
            <CardList>
              {dueSoon.slice(0, 4).map((d) => (
                <CardListItem
                  key={d.id}
                  href="/instructor/deliverables"
                  title={d.title}
                  subtitle={
                    <span className="tabular">
                      Target {d.targetQuantity} · {formatHours(d.targetHours)} · due{" "}
                      {formatDate(d.dueDate)}
                    </span>
                  }
                  trailing={<StatusPill status={d.status} />}
                />
              ))}
            </CardList>
          )}
        </Card>
      </Section>

      {/* 5 — Personal trends, last. */}
      {week ? (
        <Section title="This period" description={`${formatDate(week.from)} to ${formatDate(week.to)}`}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Utilization"
              value={week.utilizationPct}
              suffix="%"
              tone={utilizationTone(week.utilizationPct)}
              status={utilizationLabel(week.utilizationPct)}
              emphasis
              hint={`${week.productiveHours} of ${week.capacityHours} hrs`}
            />
            <StatTile label="Recorded" value={week.productiveHours} suffix="hrs" />
            <StatTile label="Available" value={week.capacityHours} suffix="hrs" />
            <StatTile
              label="Unutilized"
              value={week.unutilizedHours}
              suffix="hrs"
              tone={week.unutilizedHours > 0 ? "warning" : "neutral"}
            />
          </div>

          {week.missingDataHours > 0 ? (
            <Alert tone="warning" title="Some of your working time has no records">
              {formatHours(week.missingDataHours)} carry no activity. That is recorded as missing
              data, not as time you did not work — but it does leave your utilization
              understated.
            </Alert>
          ) : null}

          <ChartCard
            question="How was your recorded time distributed?"
            description={`${formatDate(week.from)} to ${formatDate(week.to)}`}
            isEmpty={Object.keys(week.hoursByActivityType).length === 0}
            emptyTitle="No activity recorded in this period"
            emptyDescription="Record your first activity and the distribution appears here."
          >
            <AllocationBar
              slices={Object.entries(week.hoursByActivityType).map(([code, hours]) => ({
                code,
                hours,
              }))}
              unutilizedHours={week.unutilizedHours}
              missingDataHours={week.missingDataHours}
            />
          </ChartCard>

          <ChartCard
            question="How much of each day did you use?"
            description="Recorded hours against the capacity available that day."
            isEmpty={week.days.length === 0}
          >
            <BarCompare
              bars={week.days.map((d) => ({
                label: formatWeekday(d.date),
                value: d.productiveHours,
                capacity: d.capacityHours,
                noData: d.isWorkingDay && !d.hasData,
              }))}
            />
          </ChartCard>
        </Section>
      ) : null}

      {/* 6 — Insights, last of all. */}
      {data.insights.length > 0 ? (
        <Section
          title="Personal insights"
          description="Derived from your own recorded activity only. Never shared with colleagues."
        >
          <div className="space-y-3">
            {data.insights.map((insight, i) => (
              <InsightCard key={`${insight.type}-${i}`} insight={insight} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
