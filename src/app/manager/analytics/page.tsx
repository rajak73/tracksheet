"use client";

/**
 * University-wide analytics for a manager.
 *
 * The dashboard already leads with "who needs attention" (§17); this page is
 * the deeper cut for "how is the trend moving and where is capacity going" —
 * a comparison against the previous period, plus the same allocation chart
 * scoped to the whole university rather than one instructor.
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
  complianceLabel,
  complianceTone,
  utilizationLabel,
  utilizationTone,
} from "@/app/_components/ui";
import { AllocationBar, BarCompare, ChartCard } from "@/app/_components/charts";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatDelta, formatHours, formatWeekday } from "@/app/_lib/format";

type Totals = {
  instructors: number;
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
  hoursByActivityType: Record<string, number>;
};

type Day = { date: string; isWorkingDay: boolean; hasData: boolean; capacityHours: number; productiveHours: number };

export default function ManagerAnalyticsPage() {
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) throw new Error("No university is linked to this account.");
    const universityId = me.user.universityId;
    const query = periodQuery(period);

    const current = await apiGet<{
      analytics: {
        from: string;
        to: string;
        totals: Totals;
        instructors: Array<{ days: Day[] }>;
      };
    }>(`/api/universities/${universityId}/analytics${query}`, "Could not load analytics.");

    // The comparison window — the SAME weekday-aligned prior period the report
    // and rollup already use, requested explicitly here for a delta figure.
    const from = new Date(current.analytics.from);
    const to = new Date(current.analytics.to);
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    const prevTo = new Date(from.getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86_400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const previous = await apiGet<{ analytics: { totals: Totals } }>(
      `/api/universities/${universityId}/analytics?from=${iso(prevFrom)}&to=${iso(prevTo)}`,
      "Could not load the comparison period.",
    ).catch(() => null);

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
      previousTotals: previous?.analytics.totals ?? null,
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
        <StatGridSkeleton />
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
  const p = data.previousTotals;
  const delta =
    p && p.utilizationPct !== null && t.utilizationPct !== null
      ? t.utilizationPct - p.utilizationPct
      : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description={`${formatDate(data.from)} to ${formatDate(data.to)}, compared with the equivalent prior period.`}
        actions={selector}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={t.utilizationPct}
          suffix="%"
          tone={utilizationTone(t.utilizationPct)}
          status={utilizationLabel(t.utilizationPct)}
          emphasis
          delta={delta !== null ? `${formatDelta(delta, "pt")} vs prior period` : undefined}
          deltaTone={delta === null ? undefined : delta >= 0 ? "success" : "danger"}
        />
        <StatTile label="Recorded" value={t.productiveHours} suffix="hrs" />
        <StatTile
          label="Opening compliance"
          value={t.openingCompliancePct}
          suffix="%"
          tone={complianceTone(t.openingCompliancePct)}
          status={complianceLabel(t.openingCompliancePct)}
        />
        <StatTile
          label="Closing compliance"
          value={t.closingCompliancePct}
          suffix="%"
          tone={complianceTone(t.closingCompliancePct)}
          status={complianceLabel(t.closingCompliancePct)}
        />
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

      <Section title="Allocation">
        <Card>
          <CardHeader
            title="How capacity was allocated"
            description="Across every instructor in this period."
          />
          <div className="p-5">
            {Object.keys(t.hoursByActivityType).length === 0 ? (
              <p className="text-sm text-muted">No activity recorded in this period.</p>
            ) : (
              <AllocationBar
                slices={Object.entries(t.hoursByActivityType).map(([code, hours]) => ({
                  code,
                  hours,
                }))}
                unutilizedHours={t.unutilizedHours}
                missingDataHours={t.missingDataHours}
              />
            )}
          </div>
        </Card>
      </Section>
    </div>
  );
}
