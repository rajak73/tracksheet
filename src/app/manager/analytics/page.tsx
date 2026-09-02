"use client";

/**
 * University-wide analytics for a manager.
 *
 * The dashboard already leads with "who needs attention" (§17); this page is
 * the deeper cut for "where did the time go" — the daily shape of recorded
 * time, and the same allocation chart scoped to the whole university rather
 * than one instructor.
 *
 * What it no longer does is reduce the period to a utilization score.
 * Recorded minutes over the configured working day rated an afternoon of
 * internal meetings exactly like an afternoon of lectures, and read past 100%
 * on ordinary weeks, so nothing here is expressed as a percentage of capacity
 * or as a band. The daily chart still draws the day's capacity behind the bar
 * — "nine hours of room, four hours in it" is a shape a manager can read at a
 * glance — but it stays hours, never a score.
 *
 * The hours question itself belongs to Working Hours, time spent WITH
 * STUDENTS, which is decided per entry by that entry's deliverable
 * (src/app/domain/working-hours.ts). This university-wide payload carries
 * category totals only, never the entries, so Working Hours cannot be rebuilt
 * here and is not approximated from categories. The tile therefore states the
 * figure this page genuinely holds — every recorded minute — under its own
 * name, "Recorded hours". It is never labelled "Working Hours".
 */

import { useCallback, useState } from "react";
import {
  Alert,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Section,
  StatGridSkeleton,
  StatTile,
} from "@/app/_components/ui";
import { BarCompare, ChartCard } from "@/app/_components/charts";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatHours, formatWeekday } from "@/app/_lib/format";

type Totals = {
  instructors: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
};

type Day = { date: string; isWorkingDay: boolean; hasData: boolean; capacityHours: number; productiveHours: number };

export default function ManagerAnalyticsPage() {
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const universityId = me.user.universityId;
    const query = periodQuery(period);

    // One request, one period. Nothing on this screen reads against a prior
    // window: a delta is only worth showing under a figure worth trusting, and
    // the trustworthy hours figure — Working Hours — cannot be rebuilt from
    // category totals, so the page does not pay for a second period to put a
    // comparison under.
    const current = await apiGet<{
      analytics: {
        from: string;
        to: string;
        totals: Totals;
        instructors: Array<{ days: Day[] }>;
      };
      figures: {
        totalHours: number;
        daysLogged: number;
        instructorsLogging: number;
        instructorDays: number;
      };
    }>(`/api/universities/${universityId}/analytics${query}`, "Could not load analytics.");

    // Aggregate per-weekday capacity/recorded across all instructors, purely
    // for the chart — the totals above are the server's, not recomputed here.
    const byDate = new Map<string, { capacity: number; productive: number; hasAny: boolean }>();
    for (const inst of current.analytics.instructors) {
      for (const d of inst.days) {
        const row = byDate.get(d.date) ?? { capacity: 0, productive: 0, hasAny: false };
        row.capacity += d.capacityHours;
        row.productive += d.productiveHours;
        row.hasAny = row.hasAny || d.hasData;
        byDate.set(d.date, row);
      }
    }
    const days = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    return {
      from: current.analytics.from,
      to: current.analytics.to,
      totals: current.analytics.totals,
      figures: current.figures,
      days,
    };
  }, [period]);

  const { data, error, loading, reload } = useLoad(
    load,
    period ? `${period.from}:${period.to}` : "default",
  );

  const selector = <PeriodSelector value={period} onChange={setPeriod} />;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" actions={selector} />
        <StatGridSkeleton tiles={3} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" actions={selector} />
        <ErrorState message="Unable to load analytics" detail={error ?? undefined} onRetry={reload} />
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description={`${formatDate(data.from)} to ${formatDate(data.to)}.`}
        actions={selector}
      />

      {/*
        Three tiles, and no headline percentage above them. Scoring a period
        against configured capacity — recorded minutes over the working day —
        runs past 100% on ordinary weeks and moves for reasons that have
        nothing to do with students, so it is not a number a manager is given.
        These are what this payload can state without qualification: every
        minute that was recorded, in hours and minutes rather than a decimal,
        and whether days were opened and closed.
      */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile label="Recorded hours" value={formatHours(t.productiveHours)} />
        {/* Opening and closing compliance are gone: both counted days
            carrying a DAILY_OPENING or DAILY_CLOSING entry, two codes out of
            sixteen. */}
      </div>

      {t.missingDataHours > 0 ? (
        <Alert tone="warning" title="Some working time has no records">
          {formatHours(t.missingDataHours)} carry no activity across the university.
        </Alert>
      ) : null}

      <ChartCard
        question="How much of available capacity was used each day?"
        description="Recorded hours against capacity, summed across all instructors."
        isEmpty={data.days.length === 0}
      >
        <BarCompare
          bars={data.days.map((d) => ({
            label: formatWeekday(d.date),
            value: Math.round(d.productive * 10) / 10,
            capacity: Math.round(d.capacity * 10) / 10,
            noData: !d.hasAny,
          }))}
        />
      </ChartCard>

      {/* ── What replaced the allocation bar ──────────────────────────
          The panel and its position are kept; what it shows is different.

          It used to split capacity into slices by activity type, across every
          instructor. Those slices needed a shared vocabulary to add up — one
          person writes "Java class", the next "lecture" — and a bar summing
          them asserted an agreement that never existed.

          Hours, days and coverage need none: they count days and add up hours,
          which mean the same thing in everybody's own words. Coverage is the
          one that was missing. "412 hours" says nothing about whether anybody
          failed to file; "38 of 45 instructor-days" says exactly that, which is
          the question a manager opens this page with. */}
      <Section title="What was recorded">
        <Card>
          <CardHeader
            title="Hours, days and coverage"
            description="Across every instructor in this period."
          />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <StatTile label="Total hours" value={formatHours(data.figures.totalHours)} />
            <StatTile label="Days logged" value={data.figures.daysLogged} />
            {/* An em dash where there are no instructor-days to cover, not
                "0 of 0": a period with nobody in it has no coverage to report,
                which is a different fact from nobody filing. */}
            <StatTile
              label="Coverage"
              value={
                data.figures.instructorDays === 0
                  ? "—"
                  : `${data.figures.daysLogged} of ${data.figures.instructorDays}`
              }
            />
          </div>
        </Card>
      </Section>
    </div>
  );
}
