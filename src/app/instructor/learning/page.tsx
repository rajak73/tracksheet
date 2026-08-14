"use client";

/**
 * Learning hours.
 *
 * Professional development is one of the few categories a university tracks
 * for its own sake rather than as a by-product of teaching, which is why it
 * gets a page rather than being a row in a table. The figures are the same
 * ones the analytics engine produces — this page filters the LEARNING activity
 * type out of what the server returned, it does not total anything itself.
 */

import { useCallback, useState } from "react";
import {
  Alert,
  ButtonLink,
  Card,
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
} from "@/app/_components/ui";
import { BarCompare, ChartCard } from "@/app/_components/charts";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { IconPlus } from "@/app/_components/icons";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import {
  formatDate,
  formatHours,
  formatTimeRange,
  formatWeekday,
} from "@/app/_lib/format";

type Day = {
  date: string;
  isWorkingDay: boolean;
  capacityHours: number;
  productiveHours: number;
  hasData: boolean;
  hoursByActivityType?: Record<string, number>;
};

type Activity = {
  id: string;
  workDate: string;
  startTime: string;
  endTime: string;
  status: string;
  remarks: string | null;
  activityType: { code: string; label: string };
};

export default function InstructorLearningPage() {
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    const { instructorId, universityId } = me.user;
    if (!instructorId || !universityId) {
      throw new Error("No instructor profile is linked to this account.");
    }

    const query = periodQuery(period);
    const [analytics, activities] = await Promise.all([
      apiGet<{
        analytics: {
          from: string;
          to: string;
          instructors: Array<{
            capacityHours: number;
            productiveHours: number;
            hoursByActivityType: Record<string, number>;
            days: Day[];
          }>;
        };
      }>(
        `/api/universities/${universityId}/analytics${query}`,
        "Could not load your learning hours.",
      ),
      apiGet<{ activities: Activity[]; timezone: string }>(
        `/api/instructors/${instructorId}/activities${query}`,
        "Could not load your recorded learning.",
      ),
    ]);

    const mine = analytics.analytics.instructors[0];

    return {
      from: analytics.analytics.from,
      to: analytics.analytics.to,
      learningHours: mine?.hoursByActivityType?.LEARNING ?? 0,
      productiveHours: mine?.productiveHours ?? 0,
      capacityHours: mine?.capacityHours ?? 0,
      days: mine?.days ?? [],
      // Only LEARNING records. The filter is on a code the server assigned;
      // nothing here decides what counts as learning.
      sessions: activities.activities.filter((a) => a.activityType.code === "LEARNING"),
      // University zone for DISPLAY of session times.
      timezone: activities.timezone ?? "UTC",
    };
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  const controls = (
    <>
      <PeriodSelector value={period} onChange={setPeriod} />
      <ButtonLink href="/instructor/activities">
        <IconPlus size={16} />
        Record learning
      </ButtonLink>
    </>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Learning" actions={controls} />
        <StatGridSkeleton tiles={3} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Learning" actions={controls} />
        <ErrorState message="Unable to load your learning hours" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return null;

  const sharePct =
    data.productiveHours > 0
      ? Math.round((data.learningHours / data.productiveHours) * 100)
      : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Learning"
        description={`Professional development recorded between ${formatDate(data.from)} and ${formatDate(data.to)}.`}
        actions={controls}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile
          label="Learning hours"
          value={data.learningHours}
          suffix="hrs"
          emphasis
          timeframe="This period"
        />
        <StatTile
          label="Share of recorded work"
          value={sharePct}
          suffix="%"
          hint={
            sharePct === null
              ? "No work recorded in this period"
              : `${formatHours(data.learningHours)} of ${formatHours(data.productiveHours)}`
          }
        />
        <StatTile label="Sessions recorded" value={data.sessions.length} />
      </div>

      {data.learningHours === 0 ? (
        <Alert tone="info" title="No learning recorded in this period">
          This is an absence of records rather than a judgement. If you carried out professional
          development, record it so it counts toward your workload.
        </Alert>
      ) : null}

      <ChartCard
        question="How did learning fit alongside the rest of each day?"
        description="Recorded hours against the capacity available that day."
        isEmpty={data.days.length === 0}
      >
        <BarCompare
          bars={data.days.map((d) => ({
            label: formatWeekday(d.date),
            value: d.hoursByActivityType?.LEARNING ?? 0,
            capacity: d.capacityHours,
            noData: d.isWorkingDay && !d.hasData,
            tone: "var(--cat-learning)",
          }))}
        />
      </ChartCard>

      <Section title="Recorded sessions">
        <Card>
          <CardHeader title="Learning activity" description="Your own records only." />
          {data.sessions.length === 0 ? (
            <EmptyState
              title="No learning recorded in this period"
              description="Record a learning activity and it appears here and in your workload."
              action={
                <ButtonLink href="/instructor/activities" variant="secondary">
                  Record learning
                </ButtonLink>
              }
            />
          ) : (
            <CardList>
              {data.sessions.map((s) => (
                <CardListItem
                  key={s.id}
                  title={formatDate(s.workDate)}
                  subtitle={
                    <span className="tabular">
                      {formatTimeRange(s.startTime, s.endTime, data.timezone)}
                      {s.remarks ? ` · ${s.remarks}` : ""}
                    </span>
                  }
                  trailing={<StatusPill status={s.status} />}
                />
              ))}
            </CardList>
          )}
        </Card>
      </Section>
    </div>
  );
}
