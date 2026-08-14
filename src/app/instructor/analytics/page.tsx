"use client";

/**
 * An instructor's own analytics.
 *
 * Every number here is read from the analytics engine's response for a `self`
 * scope, which the server narrows to this instructor. The page contains no
 * arithmetic beyond choosing which figure to put in which tile — a second
 * implementation of utilisation in the browser is exactly how a dashboard ends
 * up contradicting the report it links to.
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
  Table,
  TableSkeleton,
  TableWrap,
  TBody,
  TD,
  THead,
  TR,
  utilizationLabel,
  utilizationTone,
} from "@/app/_components/ui";
import {
  AllocationBar,
  BarCompare,
  ChartCard,
  TrendLine,
} from "@/app/_components/charts";
import { PeriodSelector, periodQuery, type Period } from "@/app/_components/interactive";
import { apiGet, fetchMe, useLoad } from "@/app/_lib/api";
import { formatDate, formatDateShort, formatHours, formatWeekday } from "@/app/_lib/format";

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

type Mine = {
  capacityHours: number;
  productiveHours: number;
  unutilizedHours: number;
  missingDataHours: number;
  utilizationPct: number | null;
  openingCompliancePct: number | null;
  closingCompliancePct: number | null;
  hoursByActivityType: Record<string, number>;
  days: Day[];
};

export default function InstructorAnalyticsPage() {
  const [period, setPeriod] = useState<Period | null>(null);

  const load = useCallback(async () => {
    const me = await fetchMe();
    if (!me.user.universityId) {
      throw new Error("No university is linked to this account.");
    }
    const body = await apiGet<{
      analytics: { from: string; to: string; instructors: Mine[] };
    }>(
      `/api/universities/${me.user.universityId}/analytics${periodQuery(period)}`,
      "Could not load your analytics for this period.",
    );
    return {
      from: body.analytics.from,
      to: body.analytics.to,
      mine: body.analytics.instructors[0] ?? null,
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
        <TableSkeleton cols={6} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" actions={selector} />
        <ErrorState message="Unable to load your analytics" detail={error} onRetry={reload} />
      </div>
    );
  }
  if (!data?.mine) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" actions={selector} />
        <Alert tone="info" title="Nothing to analyse for this period">
          No capacity was configured for you in this window. Try a different period.
        </Alert>
      </div>
    );
  }

  const m = data.mine;
  const workingDays = m.days.filter((d) => d.isWorkingDay);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description={`Your own recorded activity, ${formatDate(data.from)} to ${formatDate(data.to)}.`}
        actions={selector}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Utilization"
          value={m.utilizationPct}
          suffix="%"
          tone={utilizationTone(m.utilizationPct)}
          status={utilizationLabel(m.utilizationPct)}
          emphasis
          hint={`${m.productiveHours} of ${m.capacityHours} hrs`}
        />
        <StatTile label="Recorded" value={m.productiveHours} suffix="hrs" />
        <StatTile
          label="Unutilized"
          value={m.unutilizedHours}
          suffix="hrs"
          tone={m.unutilizedHours > 0 ? "warning" : "neutral"}
          hint="Capacity with no activity against it"
        />
        <StatTile
          label="No records"
          value={m.missingDataHours}
          suffix="hrs"
          tone={m.missingDataHours > 0 ? "warning" : "neutral"}
          hint="Missing data, not zero hours worked"
        />
      </div>

      {m.missingDataHours > 0 ? (
        <Alert tone="warning" title="Part of this period has no records">
          {formatHours(m.missingDataHours)} of working time carry no activity. Utilization above
          is calculated over what was recorded, so it understates your work for this period.
        </Alert>
      ) : null}

      <ChartCard
        question="How did your utilization move across the period?"
        description="Days with no records break the line rather than dropping it to zero."
        isEmpty={workingDays.length < 2}
        emptyTitle="Not enough working days to show a trend"
      >
        <TrendLine
          points={workingDays.map((d) => ({
            label: formatDateShort(d.date),
            value: d.hasData ? d.productiveHours : null,
          }))}
          unit="hrs"
        />
      </ChartCard>

      <ChartCard
        question="How was your capacity allocated?"
        isEmpty={Object.keys(m.hoursByActivityType).length === 0}
        emptyTitle="No activity recorded in this period"
      >
        <AllocationBar
          slices={Object.entries(m.hoursByActivityType).map(([code, hours]) => ({ code, hours }))}
          unutilizedHours={m.unutilizedHours}
          missingDataHours={m.missingDataHours}
        />
      </ChartCard>

      <ChartCard
        question="How much of each day did you use?"
        description="Recorded hours against that day's available capacity."
        isEmpty={m.days.length === 0}
      >
        <BarCompare
          bars={m.days.map((d) => ({
            label: formatWeekday(d.date),
            value: d.productiveHours,
            capacity: d.capacityHours,
            noData: d.isWorkingDay && !d.hasData,
          }))}
        />
      </ChartCard>

      <Section title="Day by day">
        <Card>
          <CardHeader
            title="Daily breakdown"
            description="The records behind every figure above."
          />
          <TableWrap>
            <Table caption="Daily capacity, recorded hours and compliance">
              <THead
                columns={[
                  { label: "Date" },
                  { label: "Working" },
                  { label: "Capacity", align: "right" },
                  { label: "Recorded", align: "right" },
                  { label: "Unutilized", align: "right" },
                  { label: "Open / close" },
                ]}
              />
              <TBody>
                {m.days.map((d) => (
                  <TR key={d.date}>
                    <TD strong className="tabular whitespace-nowrap">
                      {formatDate(d.date)}
                    </TD>
                    <TD>
                      {d.isWorkingDay
                        ? "Yes"
                        : d.nonWorkingReason === "HOLIDAY"
                          ? "Holiday"
                          : d.nonWorkingReason === "LEAVE"
                            ? "On leave"
                            : "No"}
                    </TD>
                    <TD align="right">{d.capacityHours}</TD>
                    <TD align="right">{d.productiveHours}</TD>
                    <TD align="right">
                      {d.unutilizedHours === null ? (
                        <span className="text-warning">No data</span>
                      ) : (
                        d.unutilizedHours
                      )}
                    </TD>
                    <TD>
                      <span className="tabular">
                        {d.openingLogged ? "✓" : "—"} / {d.closingLogged ? "✓" : "—"}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </Section>
    </div>
  );
}
